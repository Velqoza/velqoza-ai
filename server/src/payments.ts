import { db } from './db.js'
import { randomUUID } from 'node:crypto'
import { PACKAGES, calculateCustomPrice, type CustomQuantity } from './credits.js'

// Live can only be activated on the actual production deployment by its
// authorized merchant, never on the isolated staging deployment.
export function paypalMode(): 'sandbox'|'live'|null {
  const env=process.env.PAYPAL_ENV
  const credentials=Boolean(process.env.PAYPAL_CLIENT_ID?.trim()&&process.env.PAYPAL_CLIENT_SECRET?.trim())
  if(!credentials)return null
  // Extra fail-closed guard: production Live can never run on our isolated staging service.
  if(env==='live'&&process.env.RENDER_SERVICE_ID==='srv-dbs3comi0phs73c0s1dg')return null
  if(env==='sandbox'&&process.env.STAGING_INIT_SCHEMA==='true')return 'sandbox'
  if(env==='live'&&process.env.STAGING_INIT_SCHEMA!=='true'&&
     process.env.NODE_ENV==='production'&&process.env.ENABLE_LIVE_PAYMENTS==='true'&&
     process.env.LIVE_PAYMENTS_APPROVED==='true'&&Boolean(process.env.PAYPAL_WEBHOOK_ID?.trim()))return 'live'
  return null
}
// Read-only Live diagnostics: no orders, captures, refunds, or wallet changes.
// This deliberately bypasses paypalReady(), because checkout must remain disabled
// while the operator verifies credentials and the registered webhook.
export type LiveDiagnosticCheck={label:string;ok:boolean;detail:string}
export type LiveDiagnosticResult={checks:LiveDiagnosticCheck[];allPassed:boolean;checkoutStillDisabled:boolean}
export function inspectLiveWebhook(data:{id?:string;url?:string;event_types?:Array<{name?:string}>},webhookId:string):LiveDiagnosticCheck[]{
  const expectedUrl='https://ai.velqoza.com/api/paypal/webhook'
  const events=new Set(data.event_types?.map(x=>x.name)||[])
  const required=['PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED','CUSTOMER.DISPUTE.CREATED']
  return [
    {label:'Webhook belongs to this Live application',ok:data.id===webhookId,detail:data.id===webhookId?'PayPal returned the configured webhook.':'Webhook ID mismatch.'},
    {label:'Webhook delivery URL',ok:data.url===expectedUrl,detail:data.url===expectedUrl?'Correct VELQOZA AI HTTPS endpoint.':'Webhook URL must exactly match https://ai.velqoza.com/api/paypal/webhook.'},
    {label:'Required payment event subscriptions',ok:required.every(x=>events.has(x)),detail:required.every(x=>events.has(x))?'Capture, refund, reversal and dispute events included.':'Missing required event(s): '+required.filter(x=>!events.has(x)).join(', ')}
  ]
}
export async function diagnoseLivePayPal():Promise<LiveDiagnosticResult>{
  const checks:LiveDiagnosticCheck[]=[]
  const add=(label:string,ok:boolean,detail:string)=>checks.push({label,ok,detail})
  const client=process.env.PAYPAL_CLIENT_ID?.trim()
  const secret=process.env.PAYPAL_CLIENT_SECRET?.trim()
  const webhookId=process.env.PAYPAL_WEBHOOK_ID?.trim()
  if(process.env.NODE_ENV!=='production'||process.env.RENDER_SERVICE_ID==='srv-dbs3comi0phs73c0s1dg'||process.env.PAYPAL_ENV!=='live'){
    add('Live production deployment',false,'Diagnostics are only available for the selected Live production service.')
    return {checks,allPassed:false,checkoutStillDisabled:!paypalReady()}
  }
  if(!client||!secret||!webhookId||!/^[A-Za-z0-9]{6,50}$/.test(webhookId)){
    add('Live API configuration',false,'Live client credentials or webhook ID are missing or invalid.')
    return {checks,allPassed:false,checkoutStillDisabled:!paypalReady()}
  }
  try{
    const auth=await fetch('https://api-m.paypal.com/v1/oauth2/token',{
      method:'POST',
      headers:{Authorization:'Basic '+Buffer.from(client+':'+secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials',signal:AbortSignal.timeout(10000)
    })
    if(!auth.ok){
      add('Live PayPal OAuth authentication',false,'PayPal rejected the Live credentials (HTTP '+auth.status+').')
      return {checks,allPassed:false,checkoutStillDisabled:!paypalReady()}
    }
    const token=await auth.json() as {access_token?:string}
    if(!token.access_token){
      add('Live PayPal OAuth authentication',false,'No access token returned by PayPal.')
      return {checks,allPassed:false,checkoutStillDisabled:!paypalReady()}
    }
    add('Live PayPal OAuth authentication',true,'PayPal accepted the Live client credentials.')
    const res=await fetch('https://api-m.paypal.com/v1/notifications/webhooks/'+encodeURIComponent(webhookId),{
      headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'},
      signal:AbortSignal.timeout(10000)
    })
    if(!res.ok){
      add('Registered Live webhook lookup',false,'PayPal could not return the webhook (HTTP '+res.status+'). Check the webhook belongs to this Live app.')
      return {checks,allPassed:false,checkoutStillDisabled:!paypalReady()}
    }
    const webhook=await res.json() as {id?:string;url?:string;event_types?:Array<{name?:string}>}
    add('Registered Live webhook lookup',true,'PayPal returned a webhook for this application.')
    checks.push(...inspectLiveWebhook(webhook,webhookId))
  }catch{
    add('PayPal network connectivity',false,'Live API did not respond in time. No payment was attempted.')
  }
  return {checks,allPassed:checks.every(x=>x.ok),checkoutStillDisabled:!paypalReady()}
}

// Only sandbox card testing is enabled until merchant eligibility and 3DS
// outcomes have been verified and explicitly authorized for production.
export const cardFieldsSandboxEnabled=()=>paypalMode()==='sandbox'&&process.env.RENDER_SERVICE_ID==='srv-dbs3comi0phs73c0s1dg'
export async function paypalBrowserClientToken():Promise<string>{
  if(!cardFieldsSandboxEnabled())throw new Error('Card Fields testing is not available in this environment.')
  const client=process.env.PAYPAL_CLIENT_ID!,secret=process.env.PAYPAL_CLIENT_SECRET!
  const r=await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token',{
    method:'POST',
    headers:{Authorization:'Basic '+Buffer.from(client+':'+secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials&response_type=client_token&intent=sdk_init',
    signal:AbortSignal.timeout(15000)
  })
  if(!r.ok)throw new Error('PayPal cannot initialize Sandbox Card Fields.')
  const result=await r.json() as {access_token?:string}
  if(!result.access_token)throw new Error('PayPal did not return a Card Fields token.')
  return result.access_token
}

export function paypalReady(){return paypalMode()!==null}
// A Live release starts with an owner-only end-to-end test. The public checkout
// stays disabled until an explicit second gate is opened after a real capture,
// credit reconciliation and webhook-delivery review.
export function checkoutEnabledForUser(isOwner:boolean):boolean{
  const mode=paypalMode()
  if(mode==='sandbox')return true
  return mode==='live'&&(isOwner||process.env.LIVE_PAYMENTS_PUBLIC==='true')
}
const paypalBase=()=>paypalMode()==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com'
type PayPalOrder={id?:string;status?:string;links?:{href:string;rel:string}[];purchase_units?:{reference_id?:string;custom_id?:string;amount?:{currency_code?:string;value?:string};payments?:{captures?:{id?:string;status?:string;amount?:{currency_code?:string;value?:string}}[]}}[]}
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
export type PayPalWebhookEvent={id:string;event_type:string;resource?:{
  id?:string;capture_id?:string;links?:Array<{rel?:string;href?:string}>;amount?:{value?:string;currency_code?:string};
  disputed_transactions?:Array<{seller_transaction_id?:string;buyer_transaction_id?:string}>;
  supplementary_data?:{related_ids?:{order_id?:string}};status?:string
}}
export type PayPalWebhookHeaders={
  transmissionId:string;transmissionTime:string;certUrl:string;
  authAlgo:string;transmissionSig:string
}
// PayPal's verify-webhook-signature endpoint validates the transmission using
// the registered, environment-specific webhook ID. No event is trusted unless
// PayPal replies with an explicit SUCCESS.
export async function verifyPayPalWebhook(event:PayPalWebhookEvent,headers:PayPalWebhookHeaders){
  const webhookId=process.env.PAYPAL_WEBHOOK_ID?.trim()
  if(!paypalReady()||!webhookId)throw new Error('PayPal webhook verification is not configured.')
  if(!/^[a-zA-Z0-9]{6,50}$/.test(webhookId))throw new Error('Invalid configured webhook ID.')
  if(!headers.transmissionId||!headers.transmissionTime||!headers.transmissionSig||
     !headers.certUrl||!headers.authAlgo)return false
  if([headers.transmissionId,headers.transmissionTime,headers.certUrl,headers.authAlgo,headers.transmissionSig].some(v=>v.length>1024))return false
  const response=await paypalRequest('POST','/v1/notifications/verify-webhook-signature',{
    auth_algo:headers.authAlgo,
    cert_url:headers.certUrl,
    transmission_id:headers.transmissionId,
    transmission_sig:headers.transmissionSig,
    transmission_time:headers.transmissionTime,
    webhook_id:webhookId,
    webhook_event:event
  }) as PayPalOrder & {verification_status?:string}
  return response.verification_status==='SUCCESS'
}
// Match a signed capture event to an immutable local order via PayPal's API.
export function completedWebhookReference(event:PayPalWebhookEvent):{orderId:string;captureId:string}|null{
  if(event.event_type!=='PAYMENT.CAPTURE.COMPLETED')return null
  const orderId=event.resource?.supplementary_data?.related_ids?.order_id
  const captureId=event.resource?.id
  if(!orderId||!captureId||!/^[A-Za-z0-9]{8,32}$/.test(orderId)||!/^[A-Za-z0-9]{8,64}$/.test(captureId))return null
  return {orderId,captureId}
}
export function webhookCaptureId(event:PayPalWebhookEvent):string|null {
  if(event.event_type==='PAYMENT.CAPTURE.REFUNDED' ||
     event.event_type==='PAYMENT.CAPTURE.REVERSED'){
    if(event.resource?.capture_id)return event.resource.capture_id
    // Refund notifications can carry the parent capture only as a relation.
    const parent=event.resource?.links?.find(link=>link.rel==='up' && typeof link.href==='string' &&
      /^https:\/\/api-m\.(?:sandbox\.)?paypal\.com\/v2\/payments\/captures\/[A-Za-z0-9]+$/.test(link.href))
    return parent?.href?.split('/').pop()||null
  }
  if(event.event_type.startsWith('CUSTOMER.DISPUTE.')){
    const candidates=event.resource?.disputed_transactions||[]
    return candidates.length===1?candidates[0]?.seller_transaction_id||null:null
  }
  return null
}
export function recordVerifiedPaymentEvent(event:PayPalWebhookEvent):{recorded:boolean;flagged:boolean}{
  if(!/^[a-zA-Z0-9_-]{8,128}$/.test(event.id)||!/^[-A-Z.]{5,80}$/.test(event.event_type))
    throw new Error('Invalid verified payment event.')
  const captureId=webhookCaptureId(event)
  return db.transaction(()=>{
    const match=captureId?
      db.prepare('SELECT id FROM package_payments WHERE paypal_capture_id=?').get(captureId) as {id:string}|undefined:undefined
    const receipt=db.prepare('INSERT OR IGNORE INTO payment_webhook_events(id,event_type,capture_id,payment_id,received_at) VALUES(?,?,?,?,?)')
      .run(event.id,event.event_type,captureId,match?.id||null,new Date().toISOString())
    if(!receipt.changes)return {recorded:false,flagged:false}
    if(match && (
      event.event_type==='PAYMENT.CAPTURE.REFUNDED' ||
      event.event_type==='PAYMENT.CAPTURE.REVERSED' ||
      event.event_type.startsWith('CUSTOMER.DISPUTE.')
    )){
      // Quotas may already be consumed; never forcibly create a negative balance.
      // Mark for staff review so customer access/settlement can be handled safely.
      db.prepare("UPDATE package_payments SET status='review_required' WHERE id=? AND status='completed'").run(match.id)
      return {recorded:true,flagged:true}
    }
    return {recorded:true,flagged:false}
  })()
}
export type PaidSelection =
  | {type:'package';packageId:'starter'|'pro'|'business'|'agency';pricing?:unknown}
  | ({type:'custom'} & CustomQuantity & {pricing?:unknown})
export type PaymentGrants={credits:number;messages:number;edits:number;generations:number;amountCents:number}
export function priceSelection(selection:PaidSelection):PaymentGrants{
  if(selection.type==='custom'){
    const price=calculateCustomPrice(selection)
    return {credits:selection.credits,messages:selection.messages,edits:selection.edits,generations:selection.generations,amountCents:price.totalCents}
  }
  const item=PACKAGES.find(p=>p.id===selection.packageId)
  if(!item)throw new Error('Unknown package.')
  return {credits:item.credits,messages:item.messages,edits:item.edits,generations:item.generations,amountCents:item.usdCents}
}
export function serializePaymentSnapshot(selection:PaidSelection,grants:PaymentGrants){
  return JSON.stringify({selection,grants})
}
export function validatedGrants(raw:string,paidCents:number):PaymentGrants {
  const stored=JSON.parse(raw) as {selection?:PaidSelection;grants?:PaymentGrants}
  // Require immutable snapshots. Old checkout records cannot be automatically
  // fulfilled until manually reconciled against the original catalog.
  const grants=stored.grants
  if(!grants||!stored.selection)throw new Error('Legacy payment lacks an immutable price snapshot; manual reconciliation required.')
  for(const key of ['credits','messages','edits','generations','amountCents'] as const){
    const n=grants[key]
    if(!Number.isSafeInteger(n)||n<0)throw new Error('Payment snapshot is invalid.')
  }
  if(grants.amountCents!==paidCents)throw new Error('Payment snapshot price mismatch.')
  if(grants.credits+grants.messages+grants.edits+grants.generations<=0)throw new Error('Payment snapshot has no entitlements.')
  return grants
}
export async function createCheckout(paymentId:string,cents:number,description:string,returnOrigin:string,method:'paypal'|'card'|'applepay'='paypal'){
  // Runtime guard also blocks unsupported methods supplied by non-TypeScript clients.
  if(!['paypal','card','applepay'].includes(method))throw new Error('Unsupported payment method.')
  if(cents<50||cents>1_000_000)throw new Error('Checkout supports orders from $0.50 to $10,000. Please reduce the selected quantities.')
  const result=await paypalRequest('POST','/v2/checkout/orders',{
    intent:'CAPTURE',
    purchase_units:[{reference_id:paymentId,custom_id:paymentId,description:description.slice(0,120),amount:{currency_code:'USD',value:(cents/100).toFixed(2)}}],
    ...(method==='paypal'?{payment_source:{paypal:{experience_context:{brand_name:'VELQOZA AI',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',
      return_url:returnOrigin+'/?payment=return',cancel_url:returnOrigin+'/?payment=cancel'}}}}
      :{})
  },'create-'+paymentId)
  if(!result.id)throw new Error('PayPal did not return an order ID.')
  return {orderId:result.id,approvalUrl:method==='paypal'?validatedApprovalUrl(result):null}
}
export async function resumeCardCheckout(orderId:string,paymentId:string,expectedCents:number){
  if(!cardFieldsSandboxEnabled())throw new Error('Sandbox Card Fields are not available.')
  const order=await retrieveCompletedCheckout(orderId)
  if(order.id!==orderId||!['CREATED','PAYER_ACTION_REQUIRED','SAVED'].includes(order.status||''))throw new Error('This payment cannot be resumed.')
  const units=order.purchase_units||[]
  if(units.length!==1||units[0].reference_id!==paymentId||units[0].custom_id!==paymentId||
     units[0].amount?.currency_code!=='USD'||!/^[0-9]+\.[0-9]{2}$/.test(units[0].amount?.value||'')||
     Math.round(Number(units[0].amount?.value)*100)!==expectedCents)throw new Error('Stored order does not match the quoted amount.')
  return {orderId,approvalUrl:null}
}
export function validatedApprovalUrl(order:PayPalOrder):string{
  const href=order.links?.find(link=>link.rel==='payer-action'||link.rel==='approve')?.href
  if(!href)throw new Error('PayPal did not provide an approval link.')
  const url=new URL(href)
  if(url.protocol!=='https:'||url.hostname!==(paypalMode()==='live'?'www.paypal.com':'www.sandbox.paypal.com'))
    throw new Error('Unexpected payment approval destination.')
  return href
}
export async function resumeCheckout(orderId:string,paymentId:string,expectedCents:number){
  const order=await retrieveCompletedCheckout(orderId)
  if(order.id!==orderId)throw new Error('PayPal returned a different order ID.')
  if(order.status==='COMPLETED'){
    if(verifiedCapture(order,paymentId,expectedCents))throw new Error('Payment is already captured; use payment recovery.')
    throw new Error('Completed PayPal payment needs manual review.')
  }
  if(order.status!=='CREATED'&&order.status!=='PAYER_ACTION_REQUIRED'&&order.status!=='SAVED')
    throw new Error('PayPal order is no longer available for approval.')
  const unit=order.purchase_units||[]
  if(unit.length!==1||unit[0].custom_id!==paymentId||unit[0].reference_id!==paymentId)
    throw new Error('PayPal order identity does not match the original payment.')
  const amount=unit[0].amount
  if(amount?.currency_code!=='USD'||!/^\d+\.\d{2}$/.test(amount.value||'')||Math.round(Number(amount.value)*100)!==expectedCents)
    throw new Error('PayPal order amount is not the agreed amount.')
  return {orderId,approvalUrl:validatedApprovalUrl(order)}
}
// Recovery is read-only at PayPal: never issue a second capture or charge.
export async function retrieveCompletedCheckout(orderId:string):Promise<PayPalOrder>{
  if(!/^[A-Z0-9]{8,32}$/i.test(orderId))throw new Error('Invalid payment order id.')
  return paypalRequest('GET','/v2/checkout/orders/'+encodeURIComponent(orderId))
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
    const payment=db.prepare('SELECT id,user_id,status,selection_json,amount_cents FROM package_payments WHERE id=?').get(paymentId) as {id:string;user_id:string;status:string;selection_json:string;amount_cents:number}|undefined
    if(!payment)throw new Error('Checkout record not found.')
    if(payment.status==='completed')return {alreadyApplied:true}
    if(payment.status!=='created')throw new Error('Checkout not available for fulfillment.')
    const grants=validatedGrants(payment.selection_json,payment.amount_cents),now=new Date().toISOString()
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
