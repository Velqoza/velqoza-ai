import test from 'node:test'
import assert from 'node:assert/strict'
import { priceSelection, serializePaymentSnapshot, validatedGrants, verifiedCapture } from '../src/payments.js'

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
