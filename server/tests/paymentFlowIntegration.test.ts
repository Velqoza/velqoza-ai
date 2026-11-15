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
  const keys=['NODE_ENV','DATABASE_PATH','DATABASE_URL','VELQOZA_PRIMARY_DB','SUPABASE_DATABASE_URL'] as const
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
  try{
    process.env.NODE_ENV='test'
    process.env.DATABASE_PATH=filename
    for(const key of ['DATABASE_URL','VELQOZA_PRIMARY_DB','SUPABASE_DATABASE_URL'])delete process.env[key]
    const [{db},{priceSelection,serializePaymentSnapshot,verifiedCapture,fulfillVerifiedPayment}]=await Promise.all([
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
    db.close()
  }finally{
    for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key]}
    rmSync(folder,{recursive:true,force:true})
  }
})
