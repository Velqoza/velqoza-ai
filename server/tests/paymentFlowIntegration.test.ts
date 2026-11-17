import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'

// Isolated SQLite fixture. The test must never connect to Render or Supabase.
test('captured package grants exactly once, rejects invalid captures and preserves audit ledger',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'velqoza-payment-flow-'))
  const filename=join(folder,'test.sqlite')
  const keys=['NODE_ENV','DATABASE_PATH','DATABASE_URL','VELQOZA_PRIMARY_DB','SUPABASE_DATABASE_URL','PAYPAL_ENV','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID','STAGING_INIT_SCHEMA'] as const
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
  try{
    process.env.NODE_ENV='test'
    process.env.DATABASE_PATH=filename
    for(const key of ['DATABASE_URL','VELQOZA_PRIMARY_DB','SUPABASE_DATABASE_URL'])delete process.env[key]
    const [{db},{priceSelection,serializePaymentSnapshot,verifiedCapture,fulfillVerifiedPayment,verifyPayPalWebhook,recordVerifiedPaymentEvent}]=await Promise.all([
      import('../src/db.js'),import('../src/payments.js')
    ])
    const userId=randomUUID(),requestId=randomUUID(),paymentId=randomUUID(),now=new Date().toISOString()
    const selection={type:'package' as const,packageId:'starter' as const}
    const grants=priceSelection(selection)
    db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)')
      .run(userId,'payment-fixture@example.invalid','not-a-real-hash',now)
    db.prepare('INSERT INTO package_requests(id,user_id,selection_json,status,created_at) VALUES(?,?,?,?,?)')
      .run(requestId,userId,JSON.stringify(selection),'pending',now)
    db.prepare('INSERT INTO package_payments(id,user_id,request_id,paypal_order_id,amount_cents,currency,selection_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(paymentId,userId,requestId,'ORDERTEST0001',grants.amountCents,'USD',serializePaymentSnapshot(selection,grants),'created',now)
    const order={id:'ORDERTEST0001',status:'COMPLETED',purchase_units:[{reference_id:paymentId,custom_id:paymentId,payments:{captures:[{id:'CAPTURETEST0001',status:'COMPLETED',amount:{currency_code:'USD',value:'25.00'}}]}}]}
    assert.equal(verifiedCapture(order,paymentId,grants.amountCents),'CAPTURETEST0001')
    assert.equal(verifiedCapture(order,paymentId,grants.amountCents+1),null)
    assert.equal(verifiedCapture(order,randomUUID(),grants.amountCents),null)
    assert.equal(fulfillVerifiedPayment(paymentId,'CAPTURETEST0001').alreadyApplied,false)
    assert.equal(fulfillVerifiedPayment(paymentId,'CAPTURETEST0001').alreadyApplied,true)
    const balance=db.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get(userId) as {balance:number}
    assert.equal(balance.balance,grants.credits)
    const ledger=db.prepare("SELECT COUNT(*) AS n,SUM(delta) AS credits FROM credit_ledger WHERE user_id=? AND kind='package'").get(userId) as {n:number;credits:number}
    assert.equal(ledger.n,1)
    assert.equal(ledger.credits,grants.credits)
    const quotas=db.prepare('SELECT kind,remaining FROM usage_quotas WHERE user_id=?').all(userId) as {kind:string;remaining:number}[]
    assert.deepEqual(Object.fromEntries(quotas.map(q=>[q.kind,q.remaining])),{studio:grants.messages,edit:grants.edits,generate:grants.generations})
    assert.equal((db.prepare('SELECT status FROM package_requests WHERE id=?').get(requestId) as {status:string}).status,'fulfilled')
    assert.equal((db.prepare('SELECT status FROM package_payments WHERE id=?').get(paymentId) as {status:string}).status,'completed')
    // Mock the Sandbox provider, not a real PayPal account. Webhooks only become
    // trusted after server-to-server PayPal signature verification succeeds.
    const originalFetch=globalThis.fetch
    const headers={transmissionId:'transmission123',transmissionTime:'2026-11-15T00:00:00Z',certUrl:'https://api.sandbox.paypal.com/cert',
      authAlgo:'SHA256withRSA',transmissionSig:'dummy-signature'}
    const refund={id:'REFUNDEVENT001',event_type:'PAYMENT.CAPTURE.REFUNDED',
      resource:{capture_id:'CAPTURETEST0001'}}
    try{
      Object.assign(process.env,{PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'sandbox-test-client',PAYPAL_CLIENT_SECRET:'sandbox-test-secret',
        PAYPAL_WEBHOOK_ID:'WEBHOOKTEST123',STAGING_INIT_SCHEMA:'true'})
      let signatureResponse='FAILURE'
      let verifyCalls=0
      globalThis.fetch=async(input,init)=>{
        const url=String(input)
        if(url.endsWith('/v1/oauth2/token'))
          return new Response(JSON.stringify({access_token:'mock-sandbox-token'}),{status:200})
        if(url.endsWith('/v1/notifications/verify-webhook-signature')){
          verifyCalls++
          assert.equal(init?.method,'POST')
          const payload=JSON.parse(String(init?.body))
          assert.equal(payload.webhook_id,'WEBHOOKTEST123')
          assert.equal(payload.transmission_id,headers.transmissionId)
          assert.equal(payload.webhook_event.id,refund.id)
          return new Response(JSON.stringify({verification_status:signatureResponse}),{status:200})
        }
        throw new Error('Unexpected outgoing network call: '+url)
      }
      assert.equal(await verifyPayPalWebhook(refund,headers),false)
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payment_webhook_events').get() as {n:number}).n,0)
      signatureResponse='SUCCESS'
      assert.equal(await verifyPayPalWebhook(refund,headers),true)
      assert.deepEqual(recordVerifiedPaymentEvent(refund),{recorded:true,flagged:true})
      assert.deepEqual(recordVerifiedPaymentEvent(refund),{recorded:false,flagged:false})
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payment_webhook_events').get() as {n:number}).n,1)
      assert.equal((db.prepare('SELECT status FROM package_payments WHERE id=?').get(paymentId) as {status:string}).status,'review_required')
      assert.equal((db.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get(userId) as {balance:number}).balance,grants.credits)
      assert.equal(verifyCalls,2)
    }finally{globalThis.fetch=originalFetch}
    db.close()
  }finally{
    for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key]}
    rmSync(folder,{recursive:true,force:true})
  }
})
