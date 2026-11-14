import { db } from './db.js'
import { randomUUID } from 'node:crypto'
import { PACKAGES, calculateCustomPrice, type CustomQuantity } from './credits.js'

// Live can only be activated on the actual production deployment by its
// authorized merchant, never on the isolated staging deployment.
export function paypalMode(): 'sandbox'|'live'|null {
  const env=process.env.PAYPAL_ENV
  const credentials=Boolean(process.env.PAYPAL_CLIENT_ID?.trim()&&process.env.PAYPAL_CLIENT_SECRET?.trim())
  if(!credentials)return null
  if(env==='sandbox'&&process.env.STAGING_INIT_SCHEMA==='true')return 'sandbox'
  if(env==='live'&&process.env.STAGING_INIT_SCHEMA!=='true'&&
     process.env.NODE_ENV==='production'&&process.env.ENABLE_LIVE_PAYMENTS==='true'&&
     process.env.LIVE_PAYMENTS_APPROVED==='true')return 'live'
  return null
}
export function paypalReady(){return paypalMode()!==null}
const paypalBase=()=>paypalMode()==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com'
type PayPalOrder={id?:string;status?:string;links?:{href:string;rel:string}[];purchase_units?:{reference_id?:string;custom_id?:string;payments?:{captures?:{id?:string;status?:string;amount?:{currency_code?:string;value?:string}}[]}}[]}
async function accessToken():Promise<string>{
  if(!paypalReady())throw new Error('PayPal checkout is not configured.')
  const client=process.env.PAYPAL_CLIENT_ID!,secret=process.env.PAYPAL_CLIENT_SECRET!
  const response=await fetch(paypalBase()+'/v1/oauth2/token',{
    method:'POST',
    headers:{Authorization:'Basic '+Buffer.from(client+':'+secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials',
    signal:AbortSignal.timeout(20_000)
  })
  if(!response.ok)throw new Error('PayPal authentication failed.')
  const data=await response.json() as {access_token?:string}
  if(!data.access_token)throw new Error('No PayPal access token.')
  return data.access_token
}
async function paypalRequest(method:'POST'|'GET',route:string,body?:unknown,requestId?:string):Promise<PayPalOrder>{
  const token=await accessToken()
  const headers:Record<string,string>={Authorization:'Bearer '+token,'Content-Type':'application/json','Accept':'application/json','Prefer':'return=representation'}
  if(requestId)headers['PayPal-Request-Id']=requestId
  const response=await fetch(paypalBase()+route,{
    method,headers,body:method==='POST'?JSON.stringify(body??{}):undefined,signal:AbortSignal.timeout(25_000)
  })
  if(!response.ok){
    // No raw provider response or credentials are forwarded to browsers.
    throw new Error('PayPal returned an error ('+response.status+').')
  }
  return response.json() as Promise<PayPalOrder>
}
export type PaidSelection =
  | {type:'package';packageId:'starter'|'pro'|'business'|'agency';pricing?:unknown}
  | ({type:'custom'} & CustomQuantity & {pricing?:unknown})
export function priceSelection(selection:PaidSelection){
  if(selection.type==='custom'){
    const price=calculateCustomPrice(selection)
    return {credits:selection.credits,messages:selection.messages,edits:selection.edits,generations:selection.generations,amountCents:price.totalCents}
  }
  const item=PACKAGES.find(p=>p.id===selection.packageId)
  if(!item)throw new Error('Unknown package.')
  return {credits:item.credits,messages:item.messages,edits:item.edits,generations:item.generations,amountCents:item.usdCents}
}
export async function createCheckout(paymentId:string,cents:number,description:string,returnOrigin:string){
  if(cents<50||cents>1_000_000)throw new Error('Checkout supports orders from $0.50 to $10,000. Please reduce the selected quantities.')
  const result=await paypalRequest('POST','/v2/checkout/orders',{
    intent:'CAPTURE',
    purchase_units:[{reference_id:paymentId,custom_id:paymentId,description:description.slice(0,120),amount:{currency_code:'USD',value:(cents/100).toFixed(2)}}],
    payment_source:{paypal:{experience_context:{brand_name:'VELQOZA AI',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',
      return_url:returnOrigin+'/?payment=return',cancel_url:returnOrigin+'/?payment=cancel'}}}
  },'create-'+paymentId)
  const href=result.links?.find(link=>link.rel==='payer-action'||link.rel==='approve')?.href
  if(!result.id || !href)throw new Error('PayPal did not return an approval link.')
  const url=new URL(href)
  if(url.protocol!=='https:'||url.hostname!==(paypalMode()==='live'?'www.paypal.com':'www.sandbox.paypal.com'))
    throw new Error('Unexpected payment approval destination.')
  return {orderId:result.id,approvalUrl:href}
}
export async function captureCheckout(orderId:string,paymentId:string):Promise<PayPalOrder>{
  if(!/^[A-Z0-9]{8,32}$/i.test(orderId))throw new Error('Invalid payment order id.')
  try {
    return await paypalRequest('POST','/v2/checkout/orders/'+encodeURIComponent(orderId)+'/capture',{},'capture-'+paymentId)
  }catch(error){
    // Capture may have succeeded remotely before a network interruption.
    // Read it back and only accept verifiable COMPLETED captures.
    const order=await paypalRequest('GET','/v2/checkout/orders/'+encodeURIComponent(orderId))
    if(order.status==='COMPLETED')return order
    throw error
  }
}
export function verifiedCapture(order:PayPalOrder,paymentId:string,expectedCents:number){
  if(order.status!=='COMPLETED')return null
  const units=order.purchase_units||[]
  if(units.length!==1||units[0].custom_id!==paymentId||units[0].reference_id!==paymentId)return null
  const captures=units[0].payments?.captures||[]
  if(captures.length!==1||captures[0].status!=='COMPLETED'||!captures[0].id)return null
  const capture=captures[0], amount=capture.amount
  if(amount?.currency_code!=='USD'||!/^\d+\.\d{2}$/.test(amount.value||''))return null
  if(Math.round(Number(amount.value)*100)!==expectedCents)return null
  return capture.id
}
export function fulfillVerifiedPayment(paymentId:string,captureId:string){
  return db.transaction(()=>{
    const payment=db.prepare('SELECT id,user_id,status,selection_json FROM package_payments WHERE id=?').get(paymentId) as {id:string;user_id:string;status:string;selection_json:string}|undefined
    if(!payment)throw new Error('Checkout record not found.')
    if(payment.status==='completed')return {alreadyApplied:true}
    if(payment.status!=='created')throw new Error('Checkout not available for fulfillment.')
    const selection=JSON.parse(payment.selection_json) as PaidSelection
    const grants=priceSelection(selection),now=new Date().toISOString()
    const updated=db.prepare("UPDATE package_payments SET status='completed',paypal_capture_id=?,fulfilled_at=? WHERE id=? AND status='created'")
      .run(captureId,now,paymentId)
    if(updated.changes!==1)return {alreadyApplied:true}
    if(grants.credits>0){
      db.prepare('INSERT INTO credit_wallets(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=credit_wallets.balance+excluded.balance')
        .run(payment.user_id,grants.credits)
      db.prepare('INSERT INTO credit_ledger(id,user_id,delta,kind,reference_id,created_at) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(),payment.user_id,grants.credits,'package',paymentId,now)
    }
    for(const [kind,count] of [['studio',grants.messages],['edit',grants.edits],['generate',grants.generations]] as const){
      if(count>0) db.prepare('INSERT INTO usage_quotas(user_id,kind,remaining) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET remaining=usage_quotas.remaining+excluded.remaining')
        .run(payment.user_id,kind,count)
    }
    db.prepare("UPDATE package_requests SET status='fulfilled' WHERE id=(SELECT request_id FROM package_payments WHERE id=?)").run(paymentId)
    return {alreadyApplied:false}
  })()
}
