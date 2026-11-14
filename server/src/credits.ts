import { randomUUID, createHash } from 'node:crypto'
import { db } from './db.js'

// These are sample internal prices, NOT finalized based on provider costs.
export const COSTS = {generate: 20, edit: 8, studio: 2} as const
export const PACKAGES = [
  { id:'starter', label:'Starter', usdCents:2500, credits:100 },
  { id:'pro', label:'Pro', usdCents:5900, credits:300 },
  { id:'business', label:'Business', usdCents:11900, credits:700 },
  { id:'agency', label:'Agency', usdCents:24900, credits:1600 }
] as const

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
