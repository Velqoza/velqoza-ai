import { randomUUID, createHash } from 'node:crypto'
import { db } from './db.js'

// These are sample internal prices, NOT finalized based on provider costs.
export const COSTS = {generate: 20, edit: 8, studio: 2} as const
// Catalog quotas are examples for pricing review, NOT activated entitlements.
// Credits and request allowances are separate; enabling either requires a
// verified payment and an explicit fulfillment workflow.
export const PACKAGES = [
  { id:'starter',label:'Starter',usdCents:2500,credits:100,messages:25,edits:8,generations:3 },
  { id:'pro',label:'Pro',usdCents:5900,credits:300,messages:100,edits:30,generations:12 },
  { id:'business',label:'Business',usdCents:11900,credits:700,messages:300,edits:90,generations:35 },
  { id:'agency',label:'Agency',usdCents:24900,credits:1600,messages:1000,edits:250,generations:100 }
] as const
// Provisional USD unit prices in cents. Each may be configured on the server.
// Client-visible prices are always derived from these authoritative values.
const priceCents=(key:string,fallback:number)=>{
  const raw=process.env[key]
  if(raw===undefined||raw.trim()==='')return fallback
  const n=Number(raw)
  if(!Number.isSafeInteger(n)||n<1||n>100_000)throw new Error(`Invalid ${key} setting`)
  return n
}
export const CUSTOM_UNIT_PRICES_CENTS={
  credits:priceCents('CUSTOM_CREDIT_CENTS',20),
  messages:priceCents('CUSTOM_MESSAGE_CENTS',10),
  edits:priceCents('CUSTOM_EDIT_CENTS',75),
  generations:priceCents('CUSTOM_GENERATION_CENTS',250)
} as const
export type CustomQuantity={credits:number;messages:number;edits:number;generations:number}
export function calculateCustomPrice(quantity:CustomQuantity){
  const lineItems=(Object.keys(CUSTOM_UNIT_PRICES_CENTS) as (keyof CustomQuantity)[]).map(key=>({
    key,quantity:quantity[key],unitCents:CUSTOM_UNIT_PRICES_CENTS[key],
    subtotalCents:quantity[key]*CUSTOM_UNIT_PRICES_CENTS[key]
  }))
  const totalCents=lineItems.reduce((sum,item)=>sum+item.subtotalCents,0)
  if(!Number.isSafeInteger(totalCents))throw new Error('Custom price exceeds supported range.')
  return {currency:'USD' as const,lineItems,totalCents,provisional:true}
}
export const CUSTOM_LIMITS = {
 credits:{min:10,max:1_000_000},
 messages:{min:1,max:1_000_000},
 edits:{min:1,max:1_000_000},
 generations:{min:1,max:1_000_000}
} as const


export function getCredits(userId:string) {
  const row = db.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get(userId) as {balance:number}|undefined
  return row?.balance ?? 0
}
export function getCreditHistory(userId:string) {
  return db.prepare('SELECT id,delta,kind,created_at AS createdAt FROM credit_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId)
}

// The update and ledger entry share one immediate SQLite transaction so
// simultaneous requests cannot overspend a wallet.
export function chargeCredits(userId:string,kind:keyof typeof COSTS): string|null {
  return db.transaction(() => {
    const amount=COSTS[kind]
    const changed=db.prepare('UPDATE credit_wallets SET balance=balance-? WHERE user_id=? AND balance>=?').run(amount,userId,amount)
    if (!changed.changes) return null
    const referenceId=randomUUID()
    db.prepare('INSERT INTO credit_ledger (id,user_id,delta,kind,reference_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(),userId,-amount,kind,referenceId,new Date().toISOString())
    return referenceId
  }).immediate()
}

export function purchasedQuota(userId:string,kind:'generate'|'edit'|'studio'){
  const row=db.prepare('SELECT remaining FROM usage_quotas WHERE user_id=? AND kind=?').get(userId,kind) as {remaining:number}|undefined
  return row?.remaining??0
}
// Purchased quota is always consumed before wallet credits. One request costs
// one paid slot, never a second credit charge.
export function chargeAI(userId:string,kind:keyof typeof COSTS):string|null {
  if(purchasedQuota(userId,kind)>0){
    const receipt=db.transaction(()=>{
      const updated=db.prepare('UPDATE usage_quotas SET remaining=remaining-1 WHERE user_id=? AND kind=? AND remaining>0').run(userId,kind)
      if(!updated.changes)return null
      const id=randomUUID()
      db.prepare('INSERT INTO quota_reservations(id,user_id,kind,refunded,created_at) VALUES(?,?,?,0,?)').run(id,userId,kind,new Date().toISOString())
      return id
    })()
    if(receipt)return 'quota:'+receipt
  }
  const referenceId=chargeCredits(userId,kind)
  return referenceId?'credits:'+referenceId:null
}
export function refundAI(userId:string,receipt:string){
  if(receipt.startsWith('credits:'))return refundCredits(userId,receipt.slice(8))
  if(!receipt.startsWith('quota:'))return
  const id=receipt.slice(6)
  db.transaction(()=>{
    const row=db.prepare('SELECT kind,refunded FROM quota_reservations WHERE id=? AND user_id=?').get(id,userId) as {kind:string;refunded:number}|undefined
    if(!row||row.refunded)return
    const update=db.prepare('UPDATE quota_reservations SET refunded=1 WHERE id=? AND user_id=? AND refunded=0').run(id,userId)
    if(update.changes)db.prepare('UPDATE usage_quotas SET remaining=remaining+1 WHERE user_id=? AND kind=?').run(userId,row.kind)
  })()
}
export function refundCredits(userId:string,referenceId:string) {
  db.transaction(() => {
    const existing=db.prepare('SELECT delta FROM credit_ledger WHERE reference_id=? AND user_id=?').get(referenceId,userId) as {delta:number}|undefined
    if(!existing || existing.delta>=0) return
    const refundId=`refund:${referenceId}`
    const inserted=db.prepare('INSERT OR IGNORE INTO credit_ledger (id,user_id,delta,kind,reference_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(),userId,-existing.delta,'refund',refundId,new Date().toISOString())
    if (inserted.changes) db.prepare('UPDATE credit_wallets SET balance=balance+? WHERE user_id=?').run(-existing.delta,userId)
  }).immediate()
}

export function redeemVoucher(userId: string, rawCode: string): {ok: boolean; balance?: number; credits?: number; error?: string} {
  // Voucher codes are URL-safe base64 tokens with VQ- prefix, case sensitive.
  const code = rawCode.trim()
  if (!/^VQ-[A-Za-z0-9_-]{28,64}$/.test(code)) return {ok:false,error:'Invalid credit code.'}
  const hash = createHash('sha256').update(code).digest('hex')
  return db.transaction(() => {
    const voucher = db.prepare('SELECT id,credits,expires_at,redeemed_at FROM credit_vouchers WHERE code_hash=?').get(hash) as {id:string;credits:number;expires_at:string|null;redeemed_at:string|null}|undefined
    if (!voucher) return {ok:false,error:'Credit code not found.'}
    if (voucher.redeemed_at) return {ok:false,error:'This credit code has already been redeemed.'}
    if (voucher.expires_at && voucher.expires_at <= new Date().toISOString()) return {ok:false,error:'This credit code has expired.'}
    const stamp=new Date().toISOString()
    const updated=db.prepare('UPDATE credit_vouchers SET redeemed_by=?,redeemed_at=? WHERE id=? AND redeemed_at IS NULL')
      .run(userId,stamp,voucher.id)
    if (!updated.changes) return {ok:false,error:'Credit code was already used.'}
    db.prepare('INSERT INTO credit_wallets(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=balance+excluded.balance')
      .run(userId,voucher.credits)
    db.prepare('INSERT INTO credit_ledger(id,user_id,delta,kind,reference_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),userId,voucher.credits,'voucher',`voucher:${voucher.id}`,stamp)
    return {ok:true,credits:voucher.credits,balance:getCredits(userId)}
  }).immediate()
}
