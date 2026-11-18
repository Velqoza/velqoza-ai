import test from 'node:test'
import assert from 'node:assert/strict'
import { paypalMode, checkoutEnabledForUser, priceSelection, serializePaymentSnapshot, validatedGrants, verifiedCapture, webhookCaptureId, completedWebhookReference, validatedApprovalUrl, inspectLiveWebhook, resumeCheckout, createCheckout } from '../src/payments.js'

test('stored package grants are immutable and amount-bound',()=>{
  const selection={type:'package' as const,packageId:'starter' as const}
  const grants=priceSelection(selection)
  const serialized=serializePaymentSnapshot(selection,grants)
  assert.equal(validatedGrants(serialized,grants.amountCents).credits,100)
  assert.throws(()=>validatedGrants(serialized,grants.amountCents+100),/mismatch/)
  assert.throws(()=>validatedGrants(JSON.stringify(selection),grants.amountCents),/Legacy payment/)
  const malicious={selection,grants:{...grants,messages:-1}}
  assert.throws(()=>validatedGrants(JSON.stringify(malicious),grants.amountCents),/invalid/)
})

test('custom quotes have deterministic cent amounts',()=>{
  const grants=priceSelection({type:'custom',credits:10,messages:2,edits:3,generations:0})
  assert.equal(grants.amountCents,445)
  assert.equal(grants.generations,0)
})
test('only one completed matching PayPal capture can fulfill a purchase',()=>{
  const paymentId='payment-test-123',orderId='ORDERTEST123'
  const order={
    id:orderId,status:'COMPLETED',
    purchase_units:[{reference_id:paymentId,custom_id:paymentId,
      payments:{captures:[{id:'CAPTURE123',status:'COMPLETED',amount:{currency_code:'USD',value:'4.45'}}]}}]
  }
  assert.equal(verifiedCapture(order,paymentId,445),'CAPTURE123')
  assert.equal(verifiedCapture(order,paymentId,446),null)
  assert.equal(verifiedCapture(order,'another-payment',445),null)
  assert.equal(verifiedCapture({...order,status:'APPROVED'},paymentId,445),null)
  assert.equal(verifiedCapture({...order,purchase_units:[{...order.purchase_units[0],payments:{captures:[{...order.purchase_units[0].payments.captures[0],status:'PENDING'}]}}]},paymentId,445),null)
  assert.equal(verifiedCapture({...order,purchase_units:[{...order.purchase_units[0],payments:{captures:[{...order.purchase_units[0].payments.captures[0],amount:{currency_code:'EUR',value:'4.45'}}]}}]},paymentId,445),null)
  assert.equal(verifiedCapture({...order,purchase_units:[...order.purchase_units,...order.purchase_units]},paymentId,445),null)
  assert.equal(verifiedCapture({...order,purchase_units:[{...order.purchase_units[0],payments:{captures:[...order.purchase_units[0].payments.captures,...order.purchase_units[0].payments.captures]}}]},paymentId,445),null)
})

test('refund and dispute webhooks identify original capture for review',()=>{
  assert.equal(webhookCaptureId({id:'EVT12345678',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{capture_id:'CAP123'}}),'CAP123')
  assert.equal(webhookCaptureId({id:'EVT12345679',event_type:'PAYMENT.CAPTURE.REVERSED',resource:{capture_id:'CAP124'}}),'CAP124')
  assert.equal(webhookCaptureId({id:'EVT12345690',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{links:[{rel:'up',href:'https://api-m.paypal.com/v2/payments/captures/CAP128'}]}}),'CAP128')
  assert.equal(webhookCaptureId({id:'EVT12345691',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{links:[{rel:'up',href:'https://evil.invalid/v2/payments/captures/CAP128'}]}}),null)
  assert.equal(webhookCaptureId({id:'EVT12345680',event_type:'CUSTOMER.DISPUTE.CREATED',resource:{disputed_transactions:[{seller_transaction_id:'CAP125'}]}}),'CAP125')
  assert.equal(webhookCaptureId({id:'EVT12345681',event_type:'CUSTOMER.DISPUTE.CREATED',resource:{disputed_transactions:[{seller_transaction_id:'CAP125'},{seller_transaction_id:'CAP126'}]}}),null)
  assert.equal(webhookCaptureId({id:'EVT12345682',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAP127'}}),null)
})

test('PayPal Live is blocked on staging, even with approval flags',()=>{
  const keys=['PAYPAL_ENV','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID','ENABLE_LIVE_PAYMENTS','LIVE_PAYMENTS_APPROVED','NODE_ENV','STAGING_INIT_SCHEMA','RENDER_SERVICE_ID'] as const
  const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
  try{
    Object.assign(process.env,{PAYPAL_ENV:'live',PAYPAL_CLIENT_ID:'test-id',PAYPAL_CLIENT_SECRET:'test-secret',PAYPAL_WEBHOOK_ID:'webhook-id1234',ENABLE_LIVE_PAYMENTS:'true',LIVE_PAYMENTS_APPROVED:'true',NODE_ENV:'production',STAGING_INIT_SCHEMA:'true',RENDER_SERVICE_ID:'srv-dbs3comi0phs73c0s1dg'})
    assert.equal(paypalMode(),null)
    delete process.env.STAGING_INIT_SCHEMA
    assert.equal(paypalMode(),null)
    process.env.RENDER_SERVICE_ID='production-test-service'
    delete process.env.LIVE_PAYMENTS_APPROVED
    assert.equal(paypalMode(),null)
    process.env.LIVE_PAYMENTS_APPROVED='true'
    assert.equal(paypalMode(),'live')
  }finally{for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k]}}
})

test('completed webhook references require valid order and capture IDs',()=>{
  const event={id:'EVENTCOMPLETED01',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE0001',supplementary_data:{related_ids:{order_id:'ORDER000001'}}}}
  assert.deepEqual(completedWebhookReference(event),{orderId:'ORDER000001',captureId:'CAPTURE0001'})
  assert.equal(completedWebhookReference({...event,event_type:'PAYMENT.CAPTURE.REFUNDED'}),null)
  assert.equal(completedWebhookReference({...event,resource:{...event.resource,id:'invalid capture'}}),null)
  assert.equal(completedWebhookReference({...event,resource:{id:'CAPTURE0001'}}),null)
})

test('approval URLs are restricted to the correct PayPal hostname',()=>{
  const original=process.env.PAYPAL_ENV
  try{
    process.env.PAYPAL_ENV='sandbox'
    const ok={links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER123'}]}
    assert.match(validatedApprovalUrl(ok),/^https:\/\/www\.sandbox\.paypal\.com\//)
    assert.throws(()=>validatedApprovalUrl({links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com.evil.example/checkout'}]}),/Unexpected payment approval destination/)
    assert.throws(()=>validatedApprovalUrl({links:[{rel:'approve',href:'http://www.sandbox.paypal.com/checkout'}]}),/Unexpected payment approval destination/)
    assert.throws(()=>validatedApprovalUrl({links:[]}),/approval link/)
  }finally{if(original===undefined)delete process.env.PAYPAL_ENV;else process.env.PAYPAL_ENV=original}
})

test('live webhook diagnostic enforces exact VELQOZA HTTPS endpoint and subscriptions',()=>{
  const id='LIVEWEBHOOK123'
  const webhook={id,url:'https://ai.velqoza.com/api/paypal/webhook',event_types:[
    {name:'PAYMENT.CAPTURE.COMPLETED'},{name:'PAYMENT.CAPTURE.REFUNDED'},
    {name:'PAYMENT.CAPTURE.REVERSED'},{name:'CUSTOMER.DISPUTE.CREATED'}]}
  assert.equal(inspectLiveWebhook(webhook,id).every(x=>x.ok),true)
  assert.equal(inspectLiveWebhook({...webhook,url:'https://evil.example/api/paypal/webhook'},id)[1].ok,false)
  assert.equal(inspectLiveWebhook({...webhook,id:'OTHER123'},id)[0].ok,false)
  assert.equal(inspectLiveWebhook({...webhook,event_types:webhook.event_types.slice(0,2)},id)[2].ok,false)
})

test('resuming a saved order checks its exact amount, identity and approval URL without capturing',async()=>{
  const keys=['PAYPAL_ENV','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','STAGING_INIT_SCHEMA'] as const
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
  const originalFetch=globalThis.fetch
  const calls:string[]=[]
  const paymentId='payment-test-resume-1'
  const orderId='ORDER12345678'
  const originalOrder={
    id:orderId,status:'CREATED',
    purchase_units:[{reference_id:paymentId,custom_id:paymentId,amount:{currency_code:'USD',value:'25.00'}}],
    links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345678'}]
  }
  let order=originalOrder
  try{
    Object.assign(process.env,{PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'test-id',PAYPAL_CLIENT_SECRET:'test-secret',STAGING_INIT_SCHEMA:'true'})
    globalThis.fetch=async(input,init)=>{
      const url=String(input)
      calls.push((init?.method||'GET')+' '+url)
      if(url.endsWith('/v1/oauth2/token'))return new Response(JSON.stringify({access_token:'mock-token'}),{status:200})
      if(url.endsWith('/v2/checkout/orders/'+orderId))return new Response(JSON.stringify(order),{status:200})
      throw new Error('Unexpected PayPal call in no-charge test.')
    }
    const good=await resumeCheckout(orderId,paymentId,2500)
    assert.equal(good.orderId,orderId)
    assert.equal(good.approvalUrl,originalOrder.links[0].href)
    assert.equal(calls.some(x=>x.includes('/capture')),false)
    order={...originalOrder,purchase_units:[{...originalOrder.purchase_units[0],amount:{currency_code:'USD',value:'24.99'}}]}
    await assert.rejects(resumeCheckout(orderId,paymentId,2500),/amount/)
    order={...originalOrder,purchase_units:[{...originalOrder.purchase_units[0],custom_id:'other-payment'}]}
    await assert.rejects(resumeCheckout(orderId,paymentId,2500),/identity/)
  }finally{
    globalThis.fetch=originalFetch
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
  }
})

test('removed Google Pay is rejected before any provider network request, while Apple Pay remains supported',async()=>{
  const keys=['PAYPAL_ENV','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','STAGING_INIT_SCHEMA','RENDER_SERVICE_ID'] as const
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
  const fetchBefore=globalThis.fetch
  let orderRequests=0
  try{
    Object.assign(process.env,{PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'mock-client',PAYPAL_CLIENT_SECRET:'mock-secret',
      STAGING_INIT_SCHEMA:'true',RENDER_SERVICE_ID:'srv-dbs3comi0phs73c0s1dg'})
    globalThis.fetch=async(input,init)=>{
      const url=String(input)
      if(url.endsWith('/v1/oauth2/token'))
        return new Response(JSON.stringify({access_token:'mock-token'}),{status:200})
      if(url.endsWith('/v2/checkout/orders')){
        orderRequests++
        const payload=JSON.parse(String(init?.body))
        assert.equal(payload.intent,'CAPTURE')
        assert.equal(payload.purchase_units[0].amount.value,'25.00')
        assert.equal(payload.payment_source?.google_pay,undefined)
        assert.equal(payload.payment_source?.paypal,undefined)
        return new Response(JSON.stringify({id:'ORDERAPPLETEST01',status:'CREATED',links:[]}),{status:201})
      }
      throw new Error('Unexpected outgoing URL')
    }
    await assert.rejects(
      createCheckout('payment-google-test',2500,'Starter','https://staging.example.invalid','googlepay' as 'applepay'),
      /Unsupported payment method/
    )
    assert.equal(orderRequests,0)
    const apple=await createCheckout('payment-apple-test',2500,'Starter','https://staging.example.invalid','applepay')
    assert.equal(apple.orderId,'ORDERAPPLETEST01')
    assert.equal(apple.approvalUrl,null)
    assert.equal(orderRequests,1)
  }finally{
    globalThis.fetch=fetchBefore
    for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}
  }
})

test('Live payments stay owner-only until the separate public release gate is opened',()=>{
  const keys=['PAYPAL_ENV','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID',
    'ENABLE_LIVE_PAYMENTS','LIVE_PAYMENTS_APPROVED','NODE_ENV','STAGING_INIT_SCHEMA',
    'RENDER_SERVICE_ID','LIVE_PAYMENTS_PUBLIC'] as const
  const originals=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
  try{
    Object.assign(process.env,{PAYPAL_ENV:'live',PAYPAL_CLIENT_ID:'mock-client',PAYPAL_CLIENT_SECRET:'mock-secret',
      PAYPAL_WEBHOOK_ID:'TESTWEBHOOK123',ENABLE_LIVE_PAYMENTS:'true',LIVE_PAYMENTS_APPROVED:'true',
      NODE_ENV:'production',STAGING_INIT_SCHEMA:'false',RENDER_SERVICE_ID:'srv-dbse48gae00c73es27a0'})
    delete process.env.LIVE_PAYMENTS_PUBLIC
    assert.equal(checkoutEnabledForUser(false),false)
    assert.equal(checkoutEnabledForUser(true),true)
    process.env.LIVE_PAYMENTS_PUBLIC='true'
    assert.equal(checkoutEnabledForUser(false),true)
    process.env.LIVE_PAYMENTS_PUBLIC='false'
    delete process.env.LIVE_PAYMENTS_APPROVED
    assert.equal(checkoutEnabledForUser(false),false)
    assert.equal(checkoutEnabledForUser(true),false)
    process.env.LIVE_PAYMENTS_APPROVED='true'
    process.env.RENDER_SERVICE_ID='srv-dbs3comi0phs73c0s1dg'
    assert.equal(checkoutEnabledForUser(false),false)
    assert.equal(checkoutEnabledForUser(true),false)
  }finally{
    for(const key of keys){
      if(originals[key]===undefined)delete process.env[key]
      else process.env[key]=originals[key]
    }
  }
})
