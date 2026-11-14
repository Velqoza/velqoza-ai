import test from 'node:test'
import assert from 'node:assert/strict'
import { paypalMode, priceSelection, serializePaymentSnapshot, validatedGrants, verifiedCapture, webhookCaptureId } from '../src/payments.js'

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
