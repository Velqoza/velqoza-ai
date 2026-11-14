import './loadEnv.js'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { newEmailToken,saveEmailToken,redeemEmailToken,sendAccountEmail,emailReady } from './emailAuth.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { db } from './db.js'
import { requireAuth, signToken } from './auth.js'
import { generateWebsite, editWebsite, chatWithStudio } from './ai.js'
import { studioPluginCatalog, runStudioPlugins } from './studioPlugins.js'
import type { AuthRequest, SiteCode } from './types.js'
import { validateExtraFiles } from './projectFiles.js'
import { COSTS, PACKAGES, getCredits, getCreditHistory, chargeCredits, refundCredits, redeemVoucher } from './credits.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const production = process.env.NODE_ENV === 'production'
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean)
if (production && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('Production requires JWT_SECRET with 32+ characters.')
if (production && (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('your_'))) throw new Error('Production requires a real OPENAI_API_KEY.')
if (production && !process.env.DATABASE_URL && !path.isAbsolute(process.env.DATABASE_PATH?.trim() || '')) throw new Error('Production requires an absolute DATABASE_PATH on persistent storage.')
if (production && !process.env.CLIENT_ORIGIN?.startsWith('https://')) throw new Error('Production requires CLIENT_ORIGIN=https://your-public-domain.')
if (production && process.env.ENABLE_PUBLIC_SIGNUP === 'true') console.warn('[VELQOZA] Public signup enabled; ensure AI budget safeguards and abuse monitoring are active.')
app.disable('x-powered-by')
app.set('trust proxy', production ? 1 : false)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
  return callback(new Error('CORS origin denied'))
}, credentials: false }))
app.use((req,res,next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store')
  next()
})
app.use(express.json({ limit: '8mb' }))
app.use('/api/ai', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }))
app.use('/api/studio', rateLimit({ windowMs: 60_000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false }))
app.use('/api/auth', rateLimit({ windowMs: 15*60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }))

const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(128) })
const codeSchema = z.object({
  title: z.string().min(1).max(160), description: z.string().max(2000),
  html: z.string().max(180000), css: z.string().max(180000), js: z.string().max(80000),
  pages: z.record(z.string().max(180000)).optional(),
  files: z.record(z.string().max(180000)).optional()
})
// Public registration is permitted, but new accounts start with 0 Credits.
// AI requests remain server-gated by the wallet, per-account limits and rate limits.
const signupBody = credentials
const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
function isAdmin(userId:string):boolean {
  if (!adminEmail || adminEmail === 'owner@example.com') return false
  const user = db.prepare('SELECT email,is_banned FROM users WHERE id=?').get(userId) as {email:string;is_banned:number}|undefined
  return !!user && !user.is_banned && user.email.toLowerCase()===adminEmail
}
const requireAdmin = (req:AuthRequest,res:express.Response,next:express.NextFunction) => {
  if (!req.userId || !isAdmin(req.userId)) return res.status(403).json({error:'Owner access required.'})
  next()
}
const audit=(adminId:string,target:string|null,action:string,detail:string)=>db.prepare('INSERT INTO admin_audit(id,admin_id,target_user_id,action,detail,created_at) VALUES (?,?,?,?,?,?)')
  .run(randomUUID(),adminId,target,action,detail,new Date().toISOString())
// Per-account limits complement IP throttling. They cannot replace provider-level spend caps.
const aiDailyLimit = (kind:'generate'|'edit'|'studio') => (kind === 'studio' ? 25 : kind === 'edit' ? 8 : 3)
const aiBudgetGuard = (kind:'generate'|'edit'|'studio') => (req:AuthRequest,res:express.Response,next:express.NextFunction) => {
  const day = new Date().toISOString().slice(0,10)
  const limit = Number(process.env[`DAILY_${kind.toUpperCase()}_LIMIT`] || aiDailyLimit(kind))
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000) return res.status(503).json({error:'Usage limits are misconfigured.'})
  if (limit === 0) return res.status(429).json({error:'This AI feature is temporarily disabled.'})
  try {
    const reservation = db.transaction(() => {
      const result = db.prepare(`INSERT INTO ai_usage(user_id,day,kind,count) VALUES(?,?,?,1)
        ON CONFLICT(user_id,day,kind) DO UPDATE SET count=ai_usage.count+1 WHERE ai_usage.count < ?`).run(req.userId,day,kind,limit)
      return result.changes > 0
    })()
    if (!reservation) return res.status(429).json({error:`Daily ${kind} limit reached. Try again tomorrow.`})
    next()
  } catch(error) { console.error('AI budget guard failed',error);res.status(503).json({error:'Usage protection is temporarily unavailable.'}) }
}
const aiConcurrency = new Set<string>()
const singleFlight = (kind:string) => (req:AuthRequest,res:express.Response,next:express.NextFunction) => {
  const key = `${req.userId}:${kind}`
  if (aiConcurrency.has(key)) return res.status(429).json({error:'An AI request is already running. Please finish it first.'})
  aiConcurrency.add(key)
  res.once('finish',()=>aiConcurrency.delete(key))
  res.once('close',()=>aiConcurrency.delete(key))
  next()
}
function publicAiError(error:unknown) {
  const raw = error instanceof Error ? error.message : ''
  if (/timed out|timeout|ETIMEDOUT/i.test(raw)) return 'AI request timed out. Your existing project was not changed. Try editing one feature at a time, or increase OPENAI_TIMEOUT_SECONDS on the server.'
  if (/not configured|invalid website structure|returned an empty response|exceeded the allowed size|could not be parsed|daily/i.test(raw)) return raw.slice(0,250)
  return 'AI service could not complete the request. Check your API configuration or retry later.'
}
const generateBody = z.object({
  prompt: z.string().trim().min(8).max(8000),
  category: z.string().min(1).max(80), style: z.string().min(1).max(80), colors: z.string().max(160)
})
const safeCode = codeSchema.superRefine((code, ctx) => {
  const fileError = validateExtraFiles(code.files)
  if (fileError) ctx.addIssue({code:'custom',message:fileError})
  if (!code.pages) return
  const names = Object.keys(code.pages)
  if (names.length > 12 || !names.includes('index.html') || names.some(n => !/^[a-z0-9][a-z0-9_-]*\.html$/i.test(n) || n.length > 80) || Object.values(code.pages).join('').length > 500000) {
    ctx.addIssue({code:'custom',message:'Invalid page list.'})
  }
})
const editBody = z.object({ instruction: z.string().trim().min(2).max(3000), code: safeCode })
const saveBody = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), code: safeCode })
const now = () => new Date().toISOString()
const publicUser = (id: string, email: string) => {
  const profile = db.prepare('SELECT display_name, email_verified, created_at FROM users WHERE id=?').get(id) as {display_name:string;email_verified:number;created_at:string}|undefined
  return { id, email, displayName:profile?.display_name || '', emailVerified: !!profile?.email_verified,
    createdAt:profile?.created_at || '', isAdmin:isAdmin(id) }
}
const authTokenBody = z.object({ token:z.string().regex(/^[0-9a-f]{64}$/) })
const genericRecovery = {message:'If the address is eligible, we have sent an email with instructions.'}

// Readiness must verify the backing store; otherwise Render may mark a broken database deployment healthy.
app.get('/api/health', (_req,res) => {
  try {
    db.prepare('SELECT 1 AS available').get()
    res.json({ok:true, database:'ready', aiConfigured:Boolean(process.env.OPENAI_API_KEY)})
  } catch (error) {
    console.error('Database health check failed', error)
    res.status(503).json({ok:false, database:'unavailable'})
  }
})

// Read-only wallet and price preview. No checkout/credit top-up API is exposed
// until a real payment provider has signed webhook verification and idempotency.
app.get('/api/credits',requireAuth,(req:AuthRequest,res) => {
  res.json({balance:getCredits(req.userId!), costs:COSTS, packages:PACKAGES, purchasesEnabled:false, ledger:getCreditHistory(req.userId!)})
})
// Prepaid code redemption is only a wallet credit, never proof of payment.
// Only a server-side admin command can mint voucher records.
app.post('/api/credits/redeem', requireAuth, rateLimit({windowMs:15*60_000,limit:8,standardHeaders:'draft-7',legacyHeaders:false}), (req:AuthRequest,res) => {
  const parsed=z.object({code:z.string().min(20).max(100)}).safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Enter a valid prepaid credit code.'})
  try {
    const result=redeemVoucher(req.userId!,parsed.data.code)
    if(!result.ok) return res.status(400).json({error:result.error})
    return res.json({ok:true,balance:result.balance,added:result.credits})
  } catch(error) {console.error('Credit redemption failed',error);return res.status(503).json({error:'Could not redeem this code right now.'})}
})
function reserveOrReject(req:AuthRequest,res:express.Response,kind:keyof typeof COSTS): string|null {
  const ref=chargeCredits(req.userId!,kind)
  if(!ref) res.status(402).json({error:`Not enough Credits. ${kind} costs ${COSTS[kind]} Credits.`, required:COSTS[kind], balance:getCredits(req.userId!)})
  return ref
}

// The signup flow does not issue a JWT until email ownership is proven.
app.post('/api/auth/signup', async (req,res) => {
  const parsed = signupBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error:'Enter a valid email and a password with at least 8 characters.' })
  if (!emailReady()) return res.status(503).json({ error:'Email verification is not configured yet. Please contact VELQOZA support.' })
  const email = parsed.data.email.trim().toLowerCase()
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email)
  if(existing) return res.status(409).json({error:'An account with this email already exists.'})
  const id = randomUUID(), token = newEmailToken()
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    db.transaction(() => {
      db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified) VALUES (?,?,?,?,0)').run(id,email,passwordHash,now())
      saveEmailToken(id,'verify',token,true)
    })()
    await sendAccountEmail(email,'verify',token)
    return res.status(201).json({pendingVerification:true,message:'Check your email for a verification link before logging in.'})
  } catch (error:any) {
    // No usable unverified account if delivery failed; let user retry.
    db.prepare('DELETE FROM users WHERE id=? AND email_verified=0').run(id)
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({error:'An account with this email already exists.'})
    console.error('Signup verification failed',error instanceof Error?error.message:'unknown error')
    return res.status(503).json({error:'Could not send the verification email. Check email provider configuration.'})
  }
})
app.post('/api/auth/verify', (req,res) => {
  const parsed=authTokenBody.safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Invalid verification link.'})
  const ok=redeemEmailToken(parsed.data.token,'verify',id=>{
    db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(id)
  })
  return ok?res.json({ok:true,message:'Email verified. You can log in now.'}):res.status(400).json({error:'Verification link expired or already used.'})
})
app.post('/api/auth/resend-verification', async(req,res)=>{
  const parsed=credentials.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({error:'Enter your email and password.'})
  const email=parsed.data.email.trim().toLowerCase()
  const row=db.prepare('SELECT id,password_hash,email_verified,is_banned FROM users WHERE email=?').get(email) as {id:string;password_hash:string;email_verified:number;is_banned:number}|undefined
  // No account enumeration when requesting a fresh confirmation link.
  if(!row || row.is_banned || row.email_verified || !(await bcrypt.compare(parsed.data.password,row.password_hash))) return res.json(genericRecovery)
  if (!emailReady()) return res.status(503).json({error:'Email sending is not configured.'})
  const token=newEmailToken()
  try {
    await sendAccountEmail(email,'verify',token)
    saveEmailToken(row.id,'verify',token)
  } catch(error) {console.error('Verification resend failed',error instanceof Error?error.message:'unknown');return res.status(503).json({error:'Could not send the email. Try again later.'})}
  return res.json(genericRecovery)
})
app.post('/api/auth/forgot-password', async(req,res)=>{
  const parsed=z.object({email:z.string().email().max(254)}).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({error:'Enter a valid email.'})
  const email=parsed.data.email.trim().toLowerCase()
  const row=db.prepare('SELECT id,email_verified,is_banned FROM users WHERE email=?').get(email) as {id:string;email_verified:number;is_banned:number}|undefined
  if(row && row.email_verified && !row.is_banned && emailReady()){
    const token=newEmailToken()
    try {await sendAccountEmail(email,'reset',token);saveEmailToken(row.id,'reset',token)}
    catch(error) {console.error('Password reset email failed',error instanceof Error?error.message:'unknown')}
  }
  return res.json(genericRecovery)
})
app.post('/api/auth/reset-password', async(req,res)=>{
  const parsed=z.object({token:z.string().regex(/^[0-9a-f]{64}$/),password:z.string().min(8).max(128)}).safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Invalid link or password (minimum 8 characters).'})
  const passwordHash=await bcrypt.hash(parsed.data.password,12)
  const ok=redeemEmailToken(parsed.data.token,'reset',id=>{db.prepare('UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?').run(passwordHash,id)})
  return ok?res.json({ok:true,message:'Password updated. Please log in.'}):res.status(400).json({error:'Reset link expired or already used.'})
})
app.post('/api/auth/login', async (req,res) => {
  const parsed = credentials.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error:'Enter a valid email and password.' })
  const email = parsed.data.email.trim().toLowerCase()
  const row = db.prepare('SELECT id,email,password_hash,is_banned,email_verified FROM users WHERE email=?').get(email) as {id:string;email:string;password_hash:string;is_banned:number;email_verified:number}|undefined
  if (!row || !(await bcrypt.compare(parsed.data.password,row.password_hash))) return res.status(401).json({ error:'Email or password is incorrect.' })
  if (row.is_banned) return res.status(403).json({error:'This account is suspended.'})
  if (!row.email_verified) return res.status(403).json({error:'Please verify your email address. Check your inbox, or use Resend verification.'})
  res.json({ token:signToken(row.id), user:publicUser(row.id,row.email) })
})
app.get('/api/auth/me',requireAuth,(req:AuthRequest,res) => {
  const row = db.prepare('SELECT id,email FROM users WHERE id=?').get(req.userId) as {id:string;email:string}|undefined
  if (!row) return res.status(401).json({ error:'Account not found.' })
  res.json({ user:publicUser(row.id,row.email) })
})

// User-managed profile. Account ownership is derived only from the verified JWT.
app.patch('/api/account/profile',requireAuth,(req:AuthRequest,res)=>{
  const parsed=z.object({displayName:z.string().trim().max(60)}).safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Name must be 60 characters or fewer.'})
  db.prepare('UPDATE users SET display_name=? WHERE id=?').run(parsed.data.displayName,req.userId!)
  const row=db.prepare('SELECT email FROM users WHERE id=?').get(req.userId!) as {email:string}
  return res.json({user:publicUser(req.userId!,row.email)})
})
app.post('/api/account/change-password',requireAuth,rateLimit({windowMs:15*60_000,limit:6,standardHeaders:'draft-7',legacyHeaders:false}),async(req:AuthRequest,res)=>{
  const parsed=z.object({currentPassword:z.string().min(1).max(128),newPassword:z.string().min(8).max(128)}).safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Enter your current password and a new password (at least 8 characters).'})
  const row=db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.userId!) as {password_hash:string}|undefined
  if(!row || !(await bcrypt.compare(parsed.data.currentPassword,row.password_hash))) return res.status(403).json({error:'Current password is incorrect.'})
  if(parsed.data.currentPassword === parsed.data.newPassword) return res.status(400).json({error:'Choose a different password.'})
  const hash=await bcrypt.hash(parsed.data.newPassword,12)
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?').run(hash,req.userId!)
  // Issue a new token to this session. Other sessions, including saved switch-account tokens, are revoked.
  return res.json({ok:true,token:signToken(req.userId!)})
})
app.post('/api/account/sign-out-other-devices',requireAuth,(req:AuthRequest,res)=>{
  db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(req.userId!)
  return res.json({ok:true,token:signToken(req.userId!)})
})

// Owner-only management. ADMIN_EMAIL must be set on the server.
app.get('/api/admin/overview', requireAuth,requireAdmin,(req:AuthRequest,res)=>{
  const users=db.prepare(`SELECT u.id,u.email,u.created_at AS createdAt,u.is_banned AS isBanned,
    COALESCE(w.balance,0) AS credits,(SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) AS projects,
    (SELECT COUNT(*) FROM ai_threads t WHERE t.user_id=u.id) AS conversations
    FROM users u LEFT JOIN credit_wallets w ON w.user_id=u.id ORDER BY u.created_at DESC LIMIT 1000`).all()
  const totals=db.prepare(`SELECT (SELECT COUNT(*) FROM users) AS accounts, (SELECT COUNT(*) FROM projects) AS projects,
   (SELECT COUNT(*) FROM users WHERE is_banned=1) AS banned, (SELECT COALESCE(SUM(balance),0) FROM credit_wallets) AS outstandingCredits`).get()
  res.json({users,totals})
})
app.get('/api/admin/audit', requireAuth,requireAdmin,(_req,res)=>{
  res.json({entries:db.prepare('SELECT action,detail,target_user_id AS targetUserId,created_at AS createdAt FROM admin_audit ORDER BY created_at DESC LIMIT 50').all()})
})
const adminCreditBody=z.object({delta:z.number().int().min(-100000).max(100000).refine(v=>v!==0),reason:z.string().trim().min(3).max(180)})
app.post('/api/admin/users/:id/credits',requireAuth,requireAdmin,(req:AuthRequest,res)=>{
  const parsed=adminCreditBody.safeParse(req.body)
  if(!parsed.success || !z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({error:'Enter a nonzero amount and an explanation.'})
  try {
    const balance=db.transaction(()=>{
      if(!db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id)) throw new Error('Account not found.')
      db.prepare('INSERT OR IGNORE INTO credit_wallets(user_id,balance) VALUES (?,0)').run(req.params.id)
      const updated=db.prepare('UPDATE credit_wallets SET balance=balance+? WHERE user_id=? AND balance+?>=0 AND balance+?<=100000000').run(parsed.data.delta,req.params.id,parsed.data.delta,parsed.data.delta)
      if(!updated.changes) throw new Error('Insufficient balance or credit cap exceeded.')
      db.prepare('INSERT INTO credit_ledger(id,user_id,delta,kind,reference_id,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),req.params.id,parsed.data.delta,'admin',`admin:${randomUUID()}`,now())
      audit(req.userId!,req.params.id,'credits',JSON.stringify(parsed.data))
      return getCredits(req.params.id)
    }).immediate()
    res.json({ok:true,balance})
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Could not change balance.'})}
})
app.post('/api/admin/users/:id/ban',requireAuth,requireAdmin,(req:AuthRequest,res)=>{
  if(!z.string().uuid().safeParse(req.params.id).success || typeof req.body?.banned!=='boolean') return res.status(400).json({error:'Invalid request.'})
  if(req.params.id===req.userId) return res.status(400).json({error:'You cannot suspend your own owner account.'})
  const result=db.transaction(()=>{
    const changed=db.prepare('UPDATE users SET is_banned=? WHERE id=?').run(req.body.banned?1:0,req.params.id)
    if(changed.changes) audit(req.userId!,req.params.id,req.body.banned?'ban':'unban','Owner action')
    return changed.changes
  }).immediate()
  if(!result) return res.status(404).json({error:'User not found.'})
  res.json({ok:true})
})
app.delete('/api/admin/users/:id',requireAuth,requireAdmin,(req:AuthRequest,res)=>{
  if(!z.string().uuid().safeParse(req.params.id).success || req.params.id===req.userId) return res.status(400).json({error:'Cannot delete this account.'})
  const parsed=z.object({confirm:z.literal('DELETE ACCOUNT')}).safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Explicit delete confirmation required.'})
  const result=db.transaction(()=>{
    const user=db.prepare('SELECT email FROM users WHERE id=?').get(req.params.id) as {email:string}|undefined
    if(!user) return false
    if(user.email.toLowerCase()===adminEmail) return false
    audit(req.userId!,req.params.id,'delete_account',`Deleted ${user.email}`)
    db.prepare('DELETE FROM users WHERE id=?').run(req.params.id)
    return true
  }).immediate()
  if(!result) return res.status(404).json({error:'Account not found or protected.'})
  res.json({ok:true})
})

app.post('/api/ai/generate',requireAuth, singleFlight('generate'), aiBudgetGuard('generate'), async (req,res) => {
  const parsed = generateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error:'Please provide a website description (at least 8 characters) and valid design settings.' })
  const creditRef=reserveOrReject(req as AuthRequest,res,'generate')
  if (!creditRef) return
  try { const code = await generateWebsite(parsed.data); res.json({ code, creditsRemaining:getCredits((req as AuthRequest).userId!) }) }
  catch(error) { refundCredits((req as AuthRequest).userId!,creditRef); console.error('Generation error',error); res.status(502).json({ error: publicAiError(error) }) }
})
app.post('/api/ai/edit',requireAuth, singleFlight('edit'), aiBudgetGuard('edit'), async (req,res) => {
  const parsed = editBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error:'Please provide an edit instruction and valid existing website code.' })
  const creditRef=reserveOrReject(req as AuthRequest,res,'edit')
  if (!creditRef) return
  try { const code = await editWebsite(parsed.data.instruction,parsed.data.code); res.json({ code, creditsRemaining:getCredits((req as AuthRequest).userId!) }) }
  catch(error) { refundCredits((req as AuthRequest).userId!,creditRef); console.error('Edit error',error); res.status(502).json({ error: publicAiError(error) }) }
})


// AI Studio: isolated, account-owned conversations and opt-in local plugins.
const studioMessage = z.object({message:z.string().trim().min(1).max(6000), pluginIds:z.array(z.enum(['seo-audit','accessibility','project-map','launch-checklist'])).max(4).default([]), projectCode:safeCode.optional()})
const threadIdSchema = z.string().uuid()
const ownsThread = (id:string, userId:string) => !!db.prepare('SELECT 1 FROM ai_threads WHERE id=? AND user_id=?').get(id,userId)
const serializeThread = (row:any) => ({id:row.id,title:row.title,createdAt:row.created_at,updatedAt:row.updated_at})
app.get('/api/studio/plugins', requireAuth, (_req,res)=>res.json({plugins:studioPluginCatalog}))
app.get('/api/studio/threads',requireAuth,(req:AuthRequest,res)=>{
  const rows = db.prepare('SELECT * FROM ai_threads WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all(req.userId)
  res.json({threads:rows.map(serializeThread)})
})
app.post('/api/studio/threads', requireAuth, (req:AuthRequest,res)=>{
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0,100) : 'New conversation'
  const timestamp=now(),id=randomUUID()
  db.prepare('INSERT INTO ai_threads(id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,req.userId,title||'New conversation',timestamp,timestamp)
  res.status(201).json({thread:{id,title:title||'New conversation',createdAt:timestamp,updatedAt:timestamp}})
})
app.get('/api/studio/threads/:id/messages', requireAuth,(req:AuthRequest,res)=>{
  if (!threadIdSchema.safeParse(req.params.id).success || !ownsThread(req.params.id,req.userId!)) return res.status(404).json({error:'Conversation not found.'})
  const rows = db.prepare('SELECT id,role,content,created_at FROM ai_thread_messages WHERE thread_id=? ORDER BY created_at ASC, rowid ASC LIMIT 500').all(req.params.id)
  res.json({messages:rows.map((row:any)=>({id:row.id,role:row.role,content:row.content,createdAt:row.created_at}))})
})
app.delete('/api/studio/threads/:id',requireAuth,(req:AuthRequest,res)=>{
  if (!threadIdSchema.safeParse(req.params.id).success) return res.status(404).json({error:'Conversation not found.'})
  const result=db.prepare('DELETE FROM ai_threads WHERE id=? AND user_id=?').run(req.params.id,req.userId)
  if (!result.changes) return res.status(404).json({error:'Conversation not found.'})
  res.json({ok:true})
})
app.post('/api/studio/threads/:id/messages',requireAuth, singleFlight('studio'), aiBudgetGuard('studio'), async(req:AuthRequest,res)=>{
  if (!threadIdSchema.safeParse(req.params.id).success || !ownsThread(req.params.id,req.userId!)) return res.status(404).json({error:'Conversation not found.'})
  const parsed=studioMessage.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({error:'Message or selected plugins are invalid.'})
  const {message,pluginIds,projectCode}=parsed.data
  const count=(db.prepare('SELECT COUNT(*) AS n FROM ai_thread_messages WHERE thread_id=?').get(req.params.id) as {n:number}).n
  if (count>=500) return res.status(400).json({error:'Conversation reached its message limit. Start a new conversation.'})
  const reports=runStudioPlugins(pluginIds,projectCode)
  const history=db.prepare('SELECT role, content FROM ai_thread_messages WHERE thread_id=? ORDER BY created_at DESC, rowid DESC LIMIT 15').all(req.params.id) as {role:'user'|'assistant';content:string}[]
  const creditRef=reserveOrReject(req,res,'studio')
  if (!creditRef) return
  try {
    const reply=await chatWithStudio([...history.reverse(),{role:'user',content:message}],reports,projectCode ? `Title: ${projectCode.title}; description: ${projectCode.description}; pages: ${Object.keys(projectCode.pages||{'index.html':projectCode.html}).join(', ')}; files: ${Object.keys(projectCode.files||{}).join(', ')}`:undefined)
    const stamp=now(), userId=randomUUID(),assistantId=randomUUID()
    db.transaction(()=>{
      db.prepare('INSERT INTO ai_thread_messages(id,thread_id,role,content,created_at) VALUES (?,?,?,?,?)').run(userId,req.params.id,'user',message,stamp)
      db.prepare('INSERT INTO ai_thread_messages(id,thread_id,role,content,created_at) VALUES (?,?,?,?,?)').run(assistantId,req.params.id,'assistant',reply,stamp)
      const title = count===0 ? message.slice(0,72) : undefined
      if(title) db.prepare('UPDATE ai_threads SET title=?,updated_at=? WHERE id=?').run(title,stamp,req.params.id)
      else db.prepare('UPDATE ai_threads SET updated_at=? WHERE id=?').run(stamp,req.params.id)
    })()
    res.json({reply,pluginReports:reports})
  } catch(e) {refundCredits(req.userId!,creditRef);console.error('Studio AI failed',e);res.status(502).json({error:publicAiError(e)})}
})

app.get('/api/projects',requireAuth,(req:AuthRequest,res) => {
  const rows = db.prepare('SELECT id,name,code_json,created_at,updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC').all(req.userId) as any[]
  res.json({ projects:rows.map(row=>({id:row.id,name:row.name,code:JSON.parse(row.code_json),createdAt:row.created_at,updatedAt:row.updated_at})) })
})
app.post('/api/projects',requireAuth,(req:AuthRequest,res) => {
  const parsed = saveBody.safeParse(req.body)
  if (!parsed.success) {
    const messages = parsed.error.issues.map(issue => `${issue.path.join('.') || 'project'}: ${issue.message}`)
    return res.status(400).json({ error: `Could not save project: ${messages.slice(0, 3).join('; ')}` })
  }
  const {id,name,code} = parsed.data
  const timestamp = now()
  if (id) {
    const existing = db.prepare('SELECT id,created_at FROM projects WHERE id=? AND user_id=?').get(id,req.userId) as {id:string;created_at:string}|undefined
    if (!existing) return res.status(404).json({ error:'Project not found.' })
    db.prepare('UPDATE projects SET name=?,code_json=?,updated_at=? WHERE id=? AND user_id=?').run(name,JSON.stringify(code),timestamp,id,req.userId)
    return res.json({ project:{id,name,code,createdAt:existing.created_at,updatedAt:timestamp} })
  }
  const projectId = randomUUID()
  db.prepare('INSERT INTO projects (id,user_id,name,code_json,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(projectId,req.userId,name,JSON.stringify(code),timestamp,timestamp)
  res.status(201).json({ project:{id:projectId,name,code,createdAt:timestamp,updatedAt:timestamp} })
})
app.patch('/api/projects/:id',requireAuth,(req:AuthRequest,res) => {
  const parsed = z.object({name:z.string().trim().min(1).max(100)}).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error:'Project name must be between 1 and 100 characters.' })
  const result = db.prepare('UPDATE projects SET name=?,updated_at=? WHERE id=? AND user_id=?').run(parsed.data.name,now(),req.params.id,req.userId)
  if (!result.changes) return res.status(404).json({ error:'Project not found.' })
  const row = db.prepare('SELECT id,name,code_json,created_at,updated_at FROM projects WHERE id=?').get(req.params.id) as any
  res.json({ project:{id:row.id,name:row.name,code:JSON.parse(row.code_json),createdAt:row.created_at,updatedAt:row.updated_at} })
})
app.delete('/api/projects/:id',requireAuth,(req:AuthRequest,res) => {
  const result = db.prepare('DELETE FROM projects WHERE id=? AND user_id=?').run(req.params.id,req.userId)
  if (!result.changes) return res.status(404).json({ error:'Project not found.' })
  res.json({ok:true})
})
// One-origin production build: serve the Vite output from the same Express service.
// Generated projects are exported only; no generated server code is executed here.
if (production) {
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')
  app.use(express.static(clientDist, {index:false,maxAge:'1h',immutable:false,dotfiles:'deny'}))
  app.get('*',(req,res,next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({error:'API route not found.'})
    if (!req.accepts('html')) return next()
    res.sendFile(path.join(clientDist,'index.html'))
  })
}
app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction) => {
  console.error('Unhandled API error',err)
  res.status(500).json({ error:'An unexpected server error occurred.' })
})
app.listen(port,()=>console.log(`VELQOZA API listening on http://localhost:${port}`))
