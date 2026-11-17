import { randomUUID } from 'node:crypto'
import { db } from './db.js'

// User-authorized, exactly-once staging promotion.
// Never accepts a client request. Never modifies Credit balances.
// Remove the ONE_TIME_GENERATION_GRANT_EMAIL environment flag after use.
export function applyOwnerTenGenerationGrant(){
  if(process.env.STAGING_INIT_SCHEMA!=='true')return
  const email=process.env.ONE_TIME_GENERATION_GRANT_EMAIL?.trim().toLowerCase()
  if(!email)return
  if(email!=='wasemabomhrof@gmail.com'){
    console.warn('[One-time generations] Not the approved account; no changes.')
    return
  }
  try{
    const result=db.transaction(()=>{
      const user=db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email) as {id:string}|undefined
      if(!user)return 'account_not_found'
      const marker='owner-complimentary-10-generations-2026-11-14'
      const already=db.prepare("SELECT id FROM admin_audit WHERE target_user_id=? AND action=? LIMIT 1")
        .get(user.id,marker) as {id:string}|undefined
      if(already)return 'already_granted'
      const existing=db.prepare("SELECT remaining FROM usage_quotas WHERE user_id=? AND kind='generate'").get(user.id) as {remaining:number}|undefined
      if(existing && (!Number.isSafeInteger(existing.remaining)||existing.remaining>1000000)) throw new Error('Invalid quota balance.')
      db.prepare("INSERT OR IGNORE INTO usage_quotas(user_id,kind,remaining) VALUES (?,'generate',0)").run(user.id)
      const update=db.prepare("UPDATE usage_quotas SET remaining=remaining+10 WHERE user_id=? AND kind='generate'").run(user.id)
      if(update.changes!==1)throw new Error('Could not update website generation requests.')
      db.prepare('INSERT INTO admin_audit(id,admin_id,target_user_id,action,detail,created_at) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(),user.id,user.id,marker,'Exactly 10 complimentary website generation requests; no Credits granted',new Date().toISOString())
      return 'granted'
    }).immediate()
    console.info('[One-time generations] '+result)
  }catch(error){
    console.error('[One-time generations] Failed; no quota granted:',error instanceof Error?error.message:'unknown error')
  }
}
