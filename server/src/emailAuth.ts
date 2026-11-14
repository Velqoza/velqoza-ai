import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { db } from './db.js'

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const newEmailToken = () => randomBytes(32).toString('hex')
export type EmailPurpose = 'verify' | 'reset'
const ttl = { verify: 24 * 60 * 60 * 1000, reset: 30 * 60 * 1000 }

export function saveEmailToken(userId: string, purpose: EmailPurpose, token: string) {
  db.transaction(() => {
    db.prepare('DELETE FROM email_auth_tokens WHERE user_id=? AND purpose=?').run(userId,purpose)
    db.prepare('INSERT INTO email_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),userId,purpose,tokenHash(token),new Date(Date.now()+ttl[purpose]).toISOString(),new Date().toISOString())
  })()
}
export function removeEmailToken(token: string, purpose: EmailPurpose) {
  db.prepare('DELETE FROM email_auth_tokens WHERE token_hash=? AND purpose=?').run(tokenHash(token),purpose)
}
export function redeemEmailToken(token: string, purpose: EmailPurpose, apply: (userId:string) => void): boolean {
  return db.transaction(() => {
    const row = db.prepare('SELECT user_id,expires_at FROM email_auth_tokens WHERE token_hash=? AND purpose=?')
      .get(tokenHash(token),purpose) as {user_id:string;expires_at:string}|undefined
    if (!row || Date.parse(row.expires_at) < Date.now()) return false
    // Atomic single-use token. Replays cannot modify the account.
    db.prepare('DELETE FROM email_auth_tokens WHERE token_hash=? AND purpose=?').run(tokenHash(token),purpose)
    apply(row.user_id)
    return true
  })()
}
function siteUrl(): string {
  const value=process.env.APP_BASE_URL?.trim() || 'http://localhost:5173'
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) {
    throw new Error('APP_BASE_URL must be HTTPS in production.')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('HTTPS required.')
  return url.origin
}
export async function sendAccountEmail(to: string, purpose: EmailPurpose, token: string) {
  const apiKey=process.env.RESEND_API_KEY?.trim()
  const from=process.env.EMAIL_FROM?.trim()
  if (!apiKey || !from) throw new Error('Email sending is not configured. Set RESEND_API_KEY and EMAIL_FROM.')
  const url = new URL(siteUrl())
  url.pathname = '/'
  url.searchParams.set(purpose==='verify'?'verify':'reset',token)
  const subject=purpose==='verify'?'Verify your VELQOZA AI email':'Reset your VELQOZA AI password'
  const action=purpose==='verify'?'Verify email':'Reset password'
  const message=purpose==='verify'?'Confirm this email address to activate your VELQOZA AI account.':'You can reset your password using this one-time link.'
  const text=`${message}\n\n${url.toString()}\n\nThis link expires in ${purpose==='verify'?'24 hours':'30 minutes'}. If you did not request it, ignore this message.`
  const controller = new AbortController()
  const timeout=setTimeout(()=>controller.abort(),12000)
  try {
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',signal:controller.signal,
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[to],subject,text,html:`<div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto;padding:30px"><h2>VELQOZA AI</h2><p>${message}</p><p><a href="${url.toString()}" style="background:#7847dd;color:white;padding:14px 22px;text-decoration:none;border-radius:8px">${action}</a></p><p>This link expires in ${purpose==='verify'?'24 hours':'30 minutes'}.</p><p>If you did not request this, ignore this message.</p></div>`})
    })
    if(!response.ok) throw new Error(`Email provider HTTP ${response.status}`)
  } finally { clearTimeout(timeout) }
}
export function emailReady() { return !!(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()) }
