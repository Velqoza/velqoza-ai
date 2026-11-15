import './loadEnv.js'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { newEmailToken,saveEmailToken,redeemEmailToken,sendAccountEmail,emailReady } from './emailAuth.js'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { db } from './db.js'
import { probeSupabaseDatabase } from './supabaseProbe.js'
import { applyOwnerTenGenerationGrant } from './oneTimeGenerationGrant.js'
import { requireAuth, signToken } from './auth.js'
import { generateWebsite, editWebsite, chatWithStudio } from './ai.js'
import { studioPluginCatalog, runStudioPlugins } from './studioPlugins.js'
import type { AuthRequest, SiteCode } from './types.js'
import { validateExtraFiles } from './projectFiles.js'
import { COSTS, PACKAGES, CUSTOM_LIMITS, CUSTOM_UNIT_PRICES_CENTS, calculateCustomPrice, getCredits, getCreditHistory, chargeAI, refundAI, purchasedQuota, redeemVoucher } from './credits.js'
import { paypalReady, paypalMode, cardFieldsSandboxEnabled, paypalBrowserClientToken, createCheckout, resumeCheckout, resumeCardCheckout, captureCheckout, retrieveCompletedCheckout, verifiedCapture, fulfillVerifiedPayment, type PaidSelection, priceSelection, serializePaymentSnapshot, validatedGrants, verifyPayPalWebhook, recordVerifiedPaymentEvent, completedWebhookReference, diagnoseLivePayPal, type PayPalWebhookEvent } from './payments.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const production = process.env.NODE_ENV === 'production'
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean)
if (production && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('Production requires JWT_SECRET with 32+ characters.')
if (production && (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('your_'))) throw new Error('Production requires a real OPENAI_API_KEY.')
if (production && !process.env.DATABASE_URL && !(process.env.VELQOZA_PRIMARY_DB === 'supabase' && process.env.SUPABASE_DATABASE_URL?.trim()) && !path.isAbsolute(process.env.DATABASE_PATH?.trim() || '')) throw new Error('Production requires a persistent PostgreSQL connection or an absolute DATABASE_PATH.')
if (production && !process.env.CLIENT_ORIGIN?.startsWith('https://')) throw new Error('Production requires CLIENT_ORIGIN=https://your-public-domain.')
if (production && process.env.ENABLE_PUBLIC_SIGNUP === 'true') console.warn('[VELQOZA] Public signup enabled; ensure AI budget safeguards and abuse monitoring are active.')
app.disable('x-powered-by')
app.set('trust proxy', production ? 1 : false)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
  return callback(new Error('CORS origin denied'))
}, credentials: false }))
app.use('/checkout',(req,res,next)=>{
  if(process.env.RENDER_SERVICE_ID==='srv-dbs3comi0phs73c0s1dg'){
    res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' https://www.sandbox.paypal.com https://www.paypal.com https://pay.google.com https://applepay.cdn-apple.com; frame-src 'self' https://*.paypal.com https://pay.google.com https://*.google.com; connect-src 'self' https://*.paypal.com https://*.paypalobjects.com https://pay.google.com https://*.google.com https://*.googleapis.com https://google.com; img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com https://*.google.com https://www.gstatic.com https://pay.google.com; style-src 'self' 'unsafe-inline' https://*.paypal.com https://pay.google.com https://fonts.googleapis.com; font-src 'self' data: https://*.paypalobjects.com https://fonts.gstatic.com")
  }
  next()
})
app.use((req,res,next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store')
  next()
})
app.use(express.json({ limit: '8mb' }))
// Subdomain routing is staging-only. DNS and TLS must be provisioned separately;
// no requests for live *.velqoza.com are intercepted without operator approval.
app.use((req,res,next)=>{
  if(process.env.STAGING_INIT_SCHEMA!=='true') return next()
  const host=req.hostname.toLowerCase()
  const match=/^([a-z0-9-]+)\.staging\.velqoza\.com$/.exec(host)
  if(!match || !validSiteName(match[1])) return next()
  const publication=publicationByName(match[1])
  if(!publication) return res.status(404).send('Site not found.')
  if(req.path.includes('/api/') || req.path.startsWith('/api')) return res.status(404).send('Not found.')
  const filename=req.path==='/'?'index.html':req.path.slice(1)
  if(filename.includes('/') || !/^[a-z0-9][a-z0-9_.-]{0,80}$/i.test(filename)) return res.status(404).send('Not found.')
  return servePublishedBySlug(req,res,publication.slug,filename)
})



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
// Rolling two-hour limits (rather than a once-per-calendar-day reset).
// Existing DAILY_*_LIMIT overrides are accepted for backwards-compatible counts;
// the limit now applies per sliding window, not per day. No change to Credits.
const aiWindowLimit = (kind:'generate'|'edit'|'studio') => (kind === 'studio' ? 25 : kind === 'edit' ? 8 : 3)
const aiWindowHours = Number(process.env.AI_LIMIT_WINDOW_HOURS || 2)
const aiWindowMs = Number.isFinite(aiWindowHours) && aiWindowHours>=1 && aiWindowHours<=24 ? aiWindowHours*3_600_000 : 2*3_600_000
const windowLimitFor = (kind:'generate'|'edit'|'studio') => {
  const configured=process.env[`WINDOW_${kind.toUpperCase()}_LIMIT`] ?? process.env[`DAILY_${kind.toUpperCase()}_LIMIT`]
  return configured===undefined?aiWindowLimit(kind):Number(configured)
}
const usageSnapshot = (userId:string) => {
  const nowMs=Date.now(), cutoff=nowMs-aiWindowMs
  const kinds=['studio','edit','generate'] as const
  const usage={} as Record<(typeof kinds)[number],{used:number;remaining:number;limit:number;purchasedRemaining:number;nextAvailableAt:string|null}>
  for (const kind of kinds) {
    const limit=windowLimitFor(kind)
    if(!Number.isSafeInteger(limit)||limit<0||limit>10000) throw new Error('Usage limits are misconfigured.')
    const timestamps=db.prepare('SELECT created_at_ms FROM ai_window_usage WHERE user_id=? AND kind=? AND created_at_ms>? ORDER BY created_at_ms ASC')
      .all(userId,kind,cutoff) as {created_at_ms:number}[]
    const used=timestamps.length, remaining=Math.max(0,limit-used)
    const first=limit>0 && used>=limit ? timestamps[used-limit]?.created_at_ms : undefined
    usage[kind]={limit,used,remaining,purchasedRemaining:purchasedQuota(userId,kind),nextAvailableAt:first===undefined?null:new Date(Number(first)+aiWindowMs).toISOString()}
  }
  return {windowHours:aiWindowMs/3600000,serverTime:new Date(nowMs).toISOString(),usage}
}
app.get('/api/usage',requireAuth,(req:AuthRequest,res)=>{
  try {res.json(usageSnapshot(req.userId!))}
  catch(error){console.error('Could not read usage',error);res.status(503).json({error:'Usage information is temporarily unavailable.'})}
})
const aiBudgetGuard = (kind:'generate'|'edit'|'studio') => (req:AuthRequest,res:express.Response,next:express.NextFunction) => {
  const limit=windowLimitFor(kind)
  if (!Number.isSafeInteger(limit) || limit<0 || limit>10000) return res.status(503).json({error:'Usage limits are misconfigured.'})
  if (limit===0) return res.status(429).json({error:'This AI feature is temporarily disabled.'})
  try {
    if(purchasedQuota(req.userId!,kind)>0)return next()
    const nowMs=Date.now(),cutoff=nowMs-aiWindowMs
    const reservation=db.transaction(()=>{
      // Clean up only this owner's expired entries, avoiding an unbounded table.
      db.prepare('DELETE FROM ai_window_usage WHERE user_id=? AND kind=? AND created_at_ms<=?').run(req.userId,kind,cutoff)
      const recent=db.prepare('SELECT created_at_ms FROM ai_window_usage WHERE user_id=? AND kind=? AND created_at_ms>? ORDER BY created_at_ms ASC')
        .all(req.userId,kind,cutoff) as {created_at_ms:number}[]
      if(recent.length>=limit)return {allowed:false,retryAfterMs:Number(recent[0].created_at_ms)+aiWindowMs-nowMs}
      db.prepare('INSERT INTO ai_window_usage(id,user_id,kind,created_at_ms) VALUES(?,?,?,?)').run(randomUUID(),req.userId,kind,nowMs)
      return {allowed:true,retryAfterMs:0}
    })()
    if(!reservation.allowed){
      const seconds=Math.max(1,Math.ceil(reservation.retryAfterMs/1000))
      res.setHeader('Retry-After',String(seconds))
      return res.status(429).json({error:`You've used your ${kind} allowance. Your next slot becomes available in ${Math.ceil(seconds/60)} minute(s).`,retryAfterSeconds:seconds})
    }
    next()
  }catch(error){console.error('AI rolling-window guard failed',error);res.status(503).json({error:'Usage protection is temporarily unavailable.'})}
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
  category: z.string().min(1).max(80), style: z.string().min(1).max(80), colors: z.string().max(160),
  language:z.enum(['auto','ar','he','en']).default('auto')
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
    // A healthy connection is not enough: verify the required AI and payment
    // tables exist before reporting this deployment as ready.
    db.prepare('SELECT id FROM users LIMIT 0').all()
    db.prepare('SELECT id FROM projects LIMIT 0').all()
    db.prepare('SELECT id FROM package_payments LIMIT 0').all()
    db.prepare('SELECT id FROM payment_webhook_events LIMIT 0').all()
    db.prepare('SELECT user_id FROM usage_quotas LIMIT 0').all()
    db.prepare('SELECT id FROM credit_ledger LIMIT 0').all()
    db.prepare('SELECT user_id FROM credit_wallets LIMIT 0').all()
    if(process.env.VELQOZA_PRIMARY_DB==='supabase'){
      const actual=db.prepare('SELECT current_schema() AS schema').get() as {schema:string}|undefined
      const expected=process.env.VELQOZA_DB_SCHEMA||'velqoza_ai'
      if(actual?.schema!==expected)throw new Error('Connected PostgreSQL schema does not match deployment role.')
    }
    res.json({ok:true, database:'ready', aiConfigured:Boolean(process.env.OPENAI_API_KEY)})
  } catch (error) {
    console.error('Database health check failed', error)
    res.status(503).json({ok:false, database:'unavailable'})
  }
})

// Read-only wallet and price preview. No checkout/credit top-up API is exposed
// until a real payment provider has signed webhook verification and idempotency.
// Read-only catalog and server-validated quote requests. This is NOT checkout:
// submitting a request grants zero credits and zero AI usage entitlement.
const quantity=z.number().int().min(0).max(1_000_000)
const customSelection=z.object({type:z.literal('custom'),credits:quantity,messages:quantity,edits:quantity,generations:quantity}).strict().superRefine((v,ctx)=>{
  for(const [name,min] of [['credits',10],['messages',1],['edits',1],['generations',1]] as const){
    if(v[name]>0 && v[name]<min)ctx.addIssue({code:'custom',path:[name],message:`Minimum ${name} is ${min}.`})
  }
  if(v.credits+v.messages+v.edits+v.generations===0)ctx.addIssue({code:'custom',message:'Choose at least one item.'})
})
const packageSelection=z.object({type:z.literal('package'),packageId:z.enum(['starter','pro','business','agency'])}).strict()
const packageRequestBody=z.union([packageSelection,customSelection])
const checkoutRequestBody=z.object({requestId:z.string().uuid(),method:z.enum(['paypal','card','googlepay','applepay']).optional()}).strict()
const paypalReturnBody=z.object({orderId:z.string().regex(/^[A-Za-z0-9]{8,32}$/)}).strict()

app.get('/api/packages',requireAuth,(_req,res)=>res.json({packages:PACKAGES,customLimits:CUSTOM_LIMITS,unitPricesCents:CUSTOM_UNIT_PRICES_CENTS,checkoutEnabled:paypalReady(),paymentMode:paypalMode(),quotasActive:false,currency:'USD'}))
app.get('/api/packages/requests',requireAuth,(req:AuthRequest,res)=>{
  const rows=db.prepare('SELECT id,selection_json,status,created_at FROM package_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 25').all(req.userId) as {id:string;selection_json:string;status:string;created_at:string}[]
  res.json({requests:rows.map(r=>({id:r.id,selection:JSON.parse(r.selection_json),status:r.status,createdAt:r.created_at}))})
})
// Owner-only order summary for the dedicated pre-payment checkout screen.
app.get('/api/packages/requests/:id/checkout-summary',requireAuth,(req:AuthRequest,res)=>{
  const id=z.string().uuid().safeParse(req.params.id)
  if(!id.success)return res.status(400).json({error:'Invalid order reference.'})
  const request=db.prepare('SELECT id,selection_json,status,created_at FROM package_requests WHERE id=? AND user_id=?')
    .get(id.data,req.userId) as {id:string;selection_json:string;status:string;created_at:string}|undefined
  if(!request)return res.status(404).json({error:'Order not found for this account.'})
  try{
    const stored=JSON.parse(request.selection_json) as PaidSelection & {pricing?:{totalCents?:number;currency?:string}}
    const selection=stored.type==='package'
      ? {type:'package' as const,packageId:stored.packageId}
      : {type:'custom' as const,credits:stored.credits,messages:stored.messages,edits:stored.edits,generations:stored.generations}
    const grants=priceSelection(selection)
    const quotedCents=stored.pricing?.totalCents
    if(typeof quotedCents!=='number'||!Number.isSafeInteger(quotedCents)||quotedCents<0||stored.pricing?.currency!=='USD')
      return res.status(409).json({error:'This quote is invalid. Create a new request.'})
    res.setHeader('Cache-Control','no-store')
    return res.json({order:{
      id:request.id,status:request.status,createdAt:request.created_at,
      packageName:selection.type==='package'?(PACKAGES.find(p=>p.id===selection.packageId)?.label||'Package'):'Custom package',
      selection,
      currency:'USD',amountCents:quotedCents,priceChanged:grants.amountCents!==quotedCents,
      credits:grants.credits,messages:grants.messages,edits:grants.edits,generations:grants.generations,
      checkoutEnabled:paypalReady(),paymentMode:paypalMode()
    }})
  }catch{return res.status(409).json({error:'This quote cannot be displayed. Create a new request.'})}
})

app.post('/api/packages/requests',requireAuth,rateLimit({windowMs:60*60_000,limit:5,standardHeaders:'draft-7',legacyHeaders:false}),(req:AuthRequest,res)=>{
  const parsed=packageRequestBody.safeParse(req.body)
  if(!parsed.success)return res.status(400).json({error:'Invalid package quantities. Credits must be 10–1,000,000; other selected items 1–1,000,000.'})
  const selection=parsed.data
  const pricing=selection.type==='custom'
    ? calculateCustomPrice(selection)
    : {currency:'USD' as const,totalCents:PACKAGES.find(p=>p.id===selection.packageId)!.usdCents,provisional:true}
  const current=(db.prepare('SELECT COUNT(*) AS n FROM package_requests WHERE user_id=? AND status=?').get(req.userId,'pending') as {n:number}).n
  if(current>=5)return res.status(429).json({error:'You already have five pending requests.'})
  const id=randomUUID(),createdAt=now()
  db.prepare('INSERT INTO package_requests(id,user_id,selection_json,status,created_at) VALUES(?,?,?,?,?)')
    .run(id,req.userId,JSON.stringify({...selection,pricing}),'pending',createdAt)
  res.status(201).json({request:{id,selection:{...selection,pricing},pricing,status:'pending',createdAt},checkoutEnabled:false,message:'Request saved for review; no payment or credits have been processed.'})
})

// Owners may cancel unpaid quote requests. Never cascade-delete a request
// associated with a PayPal checkout, even when it is still marked pending.
app.delete('/api/packages/requests/:id',requireAuth,(req:AuthRequest,res)=>{
  const parsed=z.string().uuid().safeParse(req.params.id)
  if(!parsed.success)return res.status(400).json({error:'Invalid package request ID.'})
  const request=db.prepare('SELECT id,status FROM package_requests WHERE id=? AND user_id=?')
    .get(parsed.data,req.userId) as {id:string;status:string}|undefined
  if(!request)return res.status(404).json({error:'Package request not found.'})
  if(request.status!=='pending')return res.status(409).json({error:'Only pending requests may be cancelled.'})
  const related=db.prepare('SELECT id FROM package_payments WHERE request_id=? LIMIT 1').get(request.id)
  if(related)return res.status(409).json({error:'This request has a PayPal order. Use payment recovery or contact support instead of cancelling it.'})
  const result=db.prepare("DELETE FROM package_requests WHERE id=? AND user_id=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM package_payments WHERE request_id=?)")
    .run(request.id,req.userId,request.id)
  if(!result.changes)return res.status(409).json({error:'Request changed; refresh and try again.'})
  res.json({ok:true})
})

// Browser-safe token from PayPal; never expose the merchant client secret.
app.get('/api/packages/card-fields-token',requireAuth,rateLimit({windowMs:60_000,limit:5,standardHeaders:'draft-7',legacyHeaders:false}),async(_req,res)=>{
  if(!cardFieldsSandboxEnabled())return res.status(503).json({error:'Card Fields testing is only available on Sandbox Staging.'})
  try{res.setHeader('Cache-Control','no-store');res.json({clientToken:await paypalBrowserClientToken(),sdkUrl:'https://www.sandbox.paypal.com/web-sdk/v6/core'})}
  catch(error){console.error('Sandbox Card Fields initialization failed',error);res.status(503).json({error:'PayPal Card Fields is not enabled for this Sandbox merchant or could not initialize.'})}
})
// PayPal checkout: staging Sandbox or explicitly authorized production Live. Immutable snapshots at order
// creation; no self-reported price, status or redirect token grants benefits.
app.post('/api/packages/checkout',requireAuth,rateLimit({windowMs:60*60_000,limit:8,standardHeaders:'draft-7',legacyHeaders:false}),async(req:AuthRequest,res)=>{
  if(!paypalReady())return res.status(503).json({error:'PayPal checkout is not enabled for this environment.'})
  const parsed=checkoutRequestBody.safeParse(req.body)
  if(!parsed.success)return res.status(400).json({error:'Invalid package request.'})
  const method=parsed.data.method||'paypal'
  if(method!=='paypal'&&!cardFieldsSandboxEnabled())return res.status(503).json({error:'Card and wallet payments are only enabled in Sandbox testing.'})
  const record=db.prepare('SELECT id,user_id,selection_json,status FROM package_requests WHERE id=? AND user_id=?').get(parsed.data.requestId,req.userId) as {id:string;user_id:string;selection_json:string;status:string}|undefined
  if(!record || record.status!=='pending')return res.status(404).json({error:'An unfulfilled package request is required.'})
  const selection=JSON.parse(record.selection_json) as PaidSelection
  const pricing=priceSelection(selection)
  // A quote must match what the customer saw when submitting their request.
  // Price changes require a fresh quote, never an unexpected higher charge.
  const originalQuote=(selection as PaidSelection & {pricing?:{totalCents?:number}}).pricing
  if(originalQuote?.totalCents!==pricing.amountCents)return res.status(409).json({error:'Package pricing changed. Request a new quote before checkout.'})
  if(pricing.amountCents<50||pricing.amountCents>1_000_000)return res.status(400).json({error:'Checkout is limited to $0.50–$10,000. Reduce the custom quantity.'})
  const origin=(process.env.CLIENT_ORIGIN||'').split(',').map(x=>x.trim()).find(x=>x.startsWith('https://'))
  if(!origin)return res.status(503).json({error:'Secure checkout return origin is not configured.'})
  const existing=db.prepare('SELECT id,status,paypal_order_id,amount_cents,currency FROM package_payments WHERE request_id=? AND user_id=?')
    .get(record.id,req.userId) as {id:string;status:string;paypal_order_id:string|null;amount_cents:number;currency:string}|undefined
  if(existing?.status==='completed')return res.status(409).json({error:'Package already fulfilled.'})
  if(existing && (existing.amount_cents!==pricing.amountCents||existing.currency!=='USD'))
    return res.status(409).json({error:'Stored payment price differs from the quote. Contact support.'})
  if(existing && existing.status!=='created' && existing.status!=='creating')
    return res.status(409).json({error:'Payment is not available for retry.'})
  const paymentId=existing?.id||randomUUID()
  if(!existing){
    db.prepare('INSERT INTO package_payments(id,user_id,request_id,amount_cents,currency,selection_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(paymentId,req.userId,record.id,pricing.amountCents,'USD',serializePaymentSnapshot(selection,pricing),'creating',now())
  }
  try {
    const order=existing?.paypal_order_id
      ? method!=='paypal'?await resumeCardCheckout(existing.paypal_order_id,paymentId,pricing.amountCents):await resumeCheckout(existing.paypal_order_id,paymentId,pricing.amountCents)
      : await createCheckout(paymentId,pricing.amountCents,selection.type==='custom'?'VELQOZA AI Custom':('VELQOZA AI '+selection.packageId),origin.replace(/\/$/,''),method)
    db.prepare("UPDATE package_payments SET paypal_order_id=?,status='created' WHERE id=? AND status IN ('creating','created')")
      .run(order.orderId,paymentId)
    res.json({orderId:order.orderId,approvalUrl:order.approvalUrl,sandbox:paypalMode()==='sandbox',paymentMode:paypalMode()})
  }catch(error){
    console.error('PayPal order create/resume failed',error)
    if(existing?.paypal_order_id&&paypalMode()==='sandbox'&&error instanceof Error&&error.message.includes('PayPal returned an error (404)')){
      // The app's merchant credentials can no longer see an order created with
      // the old Sandbox merchant. Never delete, capture or relink the old row.
      return res.status(409).json({code:'SANDBOX_ORDER_APP_CHANGED',
        error:'This unfinished Sandbox checkout belongs to the previous PayPal test app. Start a new Sandbox order. The previous payment record is kept for review.'})
    }
    res.status(502).json({error:'Could not open the PayPal order. If you completed payment, use payment recovery; otherwise contact support.'})
  }
})
app.post('/api/packages/checkout/capture',requireAuth,rateLimit({windowMs:60*60_000,limit:8,standardHeaders:'draft-7',legacyHeaders:false}),async(req:AuthRequest,res)=>{
  if(!paypalReady())return res.status(503).json({error:'PayPal checkout is unavailable.'})
  const parsed=paypalReturnBody.safeParse(req.body)
  if(!parsed.success)return res.status(400).json({error:'Invalid PayPal return information.'})
  const payment=db.prepare('SELECT id,status,amount_cents,currency FROM package_payments WHERE user_id=? AND paypal_order_id=?')
    .get(req.userId,parsed.data.orderId) as {id:string;status:string;amount_cents:number;currency:string}|undefined
  if(!payment)return res.status(404).json({error:'Payment is not associated with this account.'})
  if(payment.status==='completed')return res.json({ok:true,alreadyApplied:true,balance:getCredits(req.userId!)})
  if(payment.status!=='created'||payment.currency!=='USD')return res.status(409).json({error:'Payment is not ready for capture.'})
  try{
    const order=await captureCheckout(parsed.data.orderId,payment.id)
    const captureId=verifiedCapture(order,payment.id,payment.amount_cents)
    if(!captureId)return res.status(409).json({error:'Payment is not completed or the captured amount does not match. Nothing was added.'})
    const result=fulfillVerifiedPayment(payment.id,captureId)
    res.json({ok:true,alreadyApplied:result.alreadyApplied,balance:getCredits(req.userId!)})
  }catch(error){
    console.error('PayPal capture/reconciliation failed',error)
    res.status(502).json({error:'Payment confirmation could not be completed. Your credits have not been updated; retry confirmation or contact support.'})
  }
})

// Read-only, owner-scoped receipt listing for purchases completed before this UI update.
app.get('/api/packages/receipts',requireAuth,(req:AuthRequest,res)=>{
  const rows=db.prepare(`SELECT request_id AS requestId,paypal_order_id AS orderId
    FROM package_payments WHERE user_id=? AND status IN ('completed','review_required')
    AND paypal_order_id IS NOT NULL AND paypal_capture_id IS NOT NULL AND fulfilled_at IS NOT NULL
    ORDER BY fulfilled_at DESC LIMIT 50`).all(req.userId)
  res.setHeader('Cache-Control','no-store')
  res.json({receipts:rows})
})
// A receipt is only available for a completed, server-verified purchase owned by
// the signed-in customer. No user-supplied price or customer details are trusted.
app.get('/api/packages/receipt/:orderId',requireAuth,(req:AuthRequest,res)=>{
  const orderId=String(req.params.orderId||'')
  if(!/^[A-Za-z0-9]{8,32}$/.test(orderId))return res.status(400).json({error:'Invalid payment reference.'})
  const receipt=db.prepare(`SELECT p.id,p.user_id AS userId,p.paypal_order_id AS orderId,
    p.paypal_capture_id AS captureId,p.amount_cents AS amountCents,p.currency,
    p.selection_json AS selectionJson,p.created_at AS createdAt,p.fulfilled_at AS paidAt,
    u.email FROM package_payments p JOIN users u ON u.id=p.user_id
    WHERE p.paypal_order_id=? AND p.user_id=? AND p.status IN ('completed','review_required')`)
    .get(orderId,req.userId) as {id:string;userId:string;orderId:string;captureId:string|null;amountCents:number;currency:string;selectionJson:string;createdAt:string;paidAt:string|null;email:string}|undefined
  if(!receipt||!receipt.captureId||!receipt.paidAt)return res.status(404).json({error:'Verified receipt not available for this account.'})
  try{
    const grants=validatedGrants(receipt.selectionJson,receipt.amountCents)
    const snapshot=JSON.parse(receipt.selectionJson) as {selection?:PaidSelection}
    const selection=snapshot.selection
    const label=selection?.type==='package'?PACKAGES.find(p=>p.id===selection.packageId)?.label:'Custom package'
    res.setHeader('Cache-Control','no-store')
    return res.json({receipt:{receiptId:receipt.id,orderId:receipt.orderId,captureId:receipt.captureId,
      paidAt:receipt.paidAt,currency:receipt.currency,amountCents:receipt.amountCents,
      packageName:label||'VELQOZA AI package',email:receipt.email,
      credits:grants.credits,messages:grants.messages,edits:grants.edits,generations:grants.generations,
      paymentStatus:receipt.captureId?'Paid':'Pending'}})
  }catch{
    return res.status(409).json({error:'Receipt is under payment review.'})
  }
})

// Customer-triggered recovery for a capture already completed at PayPal.
// Does not execute any PayPal capture, and grants only after exact, verified matching.
app.post('/api/packages/checkout/recover',requireAuth,rateLimit({windowMs:60*60_000,limit:8,standardHeaders:'draft-7',legacyHeaders:false}),async(req:AuthRequest,res)=>{
  if(!paypalReady())return res.status(503).json({error:'PayPal is unavailable.'})
  const parsed=checkoutRequestBody.safeParse(req.body)
  if(!parsed.success)return res.status(400).json({error:'Invalid package request.'})
  const payment=db.prepare('SELECT id,status,paypal_order_id AS orderId,amount_cents AS amountCents,currency FROM package_payments WHERE user_id=? AND request_id=?')
    .get(req.userId,parsed.data.requestId) as {id:string;status:string;orderId:string|null;amountCents:number;currency:string}|undefined
  if(!payment)return res.status(404).json({error:'No PayPal order found for this request.'})
  if(payment.status==='completed')return res.json({ok:true,alreadyApplied:true,balance:getCredits(req.userId!)})
  if(payment.status!=='created'||!payment.orderId||payment.currency!=='USD')return res.status(409).json({error:'No completed payment is available for recovery.'})
  try{
    const order=await retrieveCompletedCheckout(payment.orderId)
    const captureId=verifiedCapture(order,payment.id,payment.amountCents)
    if(!captureId)return res.status(409).json({error:'PayPal has not confirmed a matching completed capture. No Credits were added.'})
    const result=fulfillVerifiedPayment(payment.id,captureId)
    return res.json({ok:true,alreadyApplied:result.alreadyApplied,balance:getCredits(req.userId!)})
  }catch(error){
    console.error('PayPal completed payment recovery failed',error)
    return res.status(502).json({error:'Unable to verify the completed payment. Please retry later or contact support.'})
  }
})

// Public PayPal notifications. Every event is verified server-to-server
// against the configured PayPal webhook ID before it can affect payment state.
app.post('/api/paypal/webhook',rateLimit({windowMs:60_000,limit:40,standardHeaders:'draft-7',legacyHeaders:false}),
  async(req,res)=>{
    if(!paypalReady()||!process.env.PAYPAL_WEBHOOK_ID?.trim())
      return res.status(503).json({error:'Payment webhook is not configured.'})
    const parsed=z.object({
      id:z.string().min(8).max(128),
      event_type:z.string().min(5).max(80),
      resource:z.record(z.unknown()).optional()
    }).passthrough().safeParse(req.body)
    if(!parsed.success)return res.status(400).json({error:'Invalid notification.'})
    const value=req.body as PayPalWebhookEvent
    const headers={
      transmissionId:String(req.get('paypal-transmission-id')||''),
      transmissionTime:String(req.get('paypal-transmission-time')||''),
      certUrl:String(req.get('paypal-cert-url')||''),
      authAlgo:String(req.get('paypal-auth-algo')||''),
      transmissionSig:String(req.get('paypal-transmission-sig')||'')
    }
    try{
      const verified=await verifyPayPalWebhook(value,headers)
      if(!verified)return res.status(401).json({error:'Invalid PayPal webhook signature.'})
      const completed=completedWebhookReference(value)
      if(completed){
        const payment=db.prepare('SELECT id,status,amount_cents AS amountCents,currency FROM package_payments WHERE paypal_order_id=?')
          .get(completed.orderId) as {id:string;status:string;amountCents:number;currency:string}|undefined
        if(payment?.status==='created'&&payment.currency==='USD'){
          const remote=await retrieveCompletedCheckout(completed.orderId)
          const captureId=verifiedCapture(remote,payment.id,payment.amountCents)
          if(!captureId||captureId!==completed.captureId)throw new Error('PayPal capture reference does not match the verified server payment.')
          fulfillVerifiedPayment(payment.id,captureId)
        }
      }
      recordVerifiedPaymentEvent(value)
      return res.status(200).json({ok:true})
    }catch(error){
      console.error('PayPal webhook verification or storage failed',error)
      // Retriable response: PayPal should redeliver rather than losing a refund notice.
      return res.status(503).json({error:'Webhook temporarily unavailable.'})
    }
  }
)

app.get('/api/credits',requireAuth,(req:AuthRequest,res) => {
  res.json({balance:getCredits(req.userId!), costs:COSTS, packages:PACKAGES,customLimits:CUSTOM_LIMITS, purchasesEnabled:false, ledger:getCreditHistory(req.userId!)})
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
  const ref=chargeAI(req.userId!,kind)
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

/* UNUSED ANNOUNCEMENTS
app.get('/api/announcements',(_req,res)=>res.json({announcements:db.prepare('SELECT id,title,body,created_at AS createdAt FROM site_announcements ORDER BY created_at DESC LIMIT 10').all()}))
const announcementInput=z.object({title:z.string().trim().min(3).max(100),body:z.string().trim().min(3).max(1500)})
app.post('/api/admin/announcements',requireAuth,requireAdmin,(req:AuthRequest,res)=>{
 const parsed=announcementInput.safeParse(req.body)
 if(!parsed.success)return res.status(400).json({error:'Title must have 3–100 characters and message 3–1500.'})
 const id=randomUUID()
 db.prepare('INSERT INTO site_announcements(id,title,body,created_at) VALUES(?,?,?,?)').run(id,parsed.data.title,parsed.data.body,new Date().toISOString())
 audit(req.userId!,null,'announcement.created',id);res.status(201).json({ok:true,id})
})
app.delete('/api/admin/announcements/:id',requireAuth,requireAdmin,(req:AuthRequest,res)=>{
 if(!z.string().uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Invalid ID.'})
 const result=db.prepare('DELETE FROM site_announcements WHERE id=?').run(req.params.id)
 if(!result.changes)return res.status(404).json({error:'Not found.'})
 audit(req.userId!,null,'announcement.deleted',req.params.id);res.json({ok:true})
})
*/
// Owner-only management. ADMIN_EMAIL must be set on the server.
app.get('/api/admin/overview', requireAuth,requireAdmin,(req:AuthRequest,res)=>{
  const users=db.prepare(`SELECT u.id,u.email,u.created_at AS createdAt,u.is_banned AS isBanned,
    COALESCE(w.balance,0) AS credits,
     COALESCE((SELECT remaining FROM usage_quotas q WHERE q.user_id=u.id AND kind='studio'),0) AS messagesRemaining,
     COALESCE((SELECT remaining FROM usage_quotas q WHERE q.user_id=u.id AND kind='edit'),0) AS editsRemaining,
     COALESCE((SELECT remaining FROM usage_quotas q WHERE q.user_id=u.id AND kind='generate'),0) AS generationsRemaining,
     (SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) AS projects,
    (SELECT COUNT(*) FROM ai_threads t WHERE t.user_id=u.id) AS conversations
    FROM users u LEFT JOIN credit_wallets w ON w.user_id=u.id ORDER BY u.created_at DESC LIMIT 1000`).all()
  const totals=db.prepare(`SELECT (SELECT COUNT(*) FROM users) AS accounts, (SELECT COUNT(*) FROM projects) AS projects,
   (SELECT COUNT(*) FROM users WHERE is_banned=1) AS banned, (SELECT COALESCE(SUM(balance),0) FROM credit_wallets) AS outstandingCredits`).get()
  res.json({users,totals})
})
// Safe, owner-only deployment readiness view. Never returns environment values,
// PayPal keys or database URLs, and does not authorize charging customers.
app.get('/api/admin/payments/readiness',requireAuth,requireAdmin,(_req,res)=>{
  const checks=[
    {label:'Production service',ok:process.env.NODE_ENV==='production'&&process.env.RENDER_SERVICE_ID!=='srv-dbs3comi0phs73c0s1dg'&&process.env.STAGING_INIT_SCHEMA!=='true'},
    {label:'Dedicated Supabase production database',ok:process.env.VELQOZA_PRIMARY_DB==='supabase'&&process.env.VELQOZA_DB_SCHEMA==='velqoza_ai_production'&&Boolean(process.env.SUPABASE_DATABASE_URL?.trim()&&process.env.SUPABASE_CA_CERT?.includes('BEGIN CERTIFICATE'))},
    {label:'HTTPS return URL configured',ok:Boolean(process.env.CLIENT_ORIGIN?.split(',').some(x=>x.trim().startsWith('https://')))},
    {label:'PayPal Live selected',ok:process.env.PAYPAL_ENV==='live'},
    {label:'PayPal merchant credentials present',ok:Boolean(process.env.PAYPAL_CLIENT_ID?.trim()&&process.env.PAYPAL_CLIENT_SECRET?.trim())},
    {label:'Separate PayPal webhook ID present',ok:Boolean(process.env.PAYPAL_WEBHOOK_ID?.trim())},
    {label:'Merchant/operator approval flags',ok:process.env.ENABLE_LIVE_PAYMENTS==='true'&&process.env.LIVE_PAYMENTS_APPROVED==='true'}
  ]
  // This report only describes configuration; data migration, backups,
  // webhook delivery and authorized merchant approval still require review.
  res.json({checks,configured:checks.every(x=>x.ok),checkoutEnabled:paypalReady(),mode:paypalMode(),note:'Configuration checks only. Data migration, persistence, endpoint reachability and real checkout have not been verified.'})
})
// Separate admin-only read-only verification; it never opens checkout or grants Credits.
app.post('/api/admin/payments/diagnostics',requireAuth,requireAdmin,rateLimit({windowMs:60_000,limit:3,standardHeaders:'draft-7',legacyHeaders:false}),async(_req,res)=>{
  try{res.json(await diagnoseLivePayPal())}
  catch{res.status(503).json({error:'PayPal diagnostics could not complete. No payment was attempted.'})}
})
// Owner-only payment review queue. This intentionally performs no provider
// refund or automatic entitlement clawback; human reconciliation is required.
app.get('/api/admin/payments',requireAuth,requireAdmin,(_req,res)=>{
  const rows=db.prepare(`SELECT p.id,p.user_id AS userId,p.request_id AS requestId,
    p.status,p.amount_cents AS amountCents,p.currency,p.paypal_order_id AS paypalOrderId,
    p.paypal_capture_id AS paypalCaptureId,p.created_at AS createdAt,p.fulfilled_at AS fulfilledAt
    FROM package_payments p ORDER BY p.created_at DESC LIMIT 100`).all()
  res.json({payments:rows})
})
app.get('/api/admin/payments/review',requireAuth,requireAdmin,(_req,res)=>{
  const rows=db.prepare(`SELECT p.id,p.user_id AS userId,p.amount_cents AS amountCents,p.currency,
    p.paypal_capture_id AS paypalCaptureId,p.status,p.created_at AS createdAt,
    e.event_type AS eventType,e.received_at AS receivedAt
    FROM package_payments p
    LEFT JOIN payment_webhook_events e ON e.payment_id=p.id
    WHERE p.status='review_required'
    ORDER BY e.received_at DESC LIMIT 100`).all()
  res.json({needsManualReview:true,payments:rows})
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
const ownerQuotaInput=z.object({kind:z.enum(['studio','edit','generate']),delta:z.number().int().min(-100000).max(100000).refine(n=>n!==0),reason:z.string().trim().min(3).max(180)})
app.post('/api/admin/users/:id/quota',requireAuth,requireAdmin,(req:AuthRequest,res)=>{
 const parsed=ownerQuotaInput.safeParse(req.body)
 if(!parsed.success || !z.string().uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Invalid AI usage adjustment.'})
 try{
   const remaining=db.transaction(()=>{
     if(!db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id))throw new Error('Account not found.')
     const {kind,delta,reason}=parsed.data
     db.prepare('INSERT OR IGNORE INTO usage_quotas(user_id,kind,remaining) VALUES(?,?,0)').run(req.params.id,kind)
     const changed=db.prepare('UPDATE usage_quotas SET remaining=remaining+? WHERE user_id=? AND kind=? AND remaining+?>=0 AND remaining+?<=1000000').run(delta,req.params.id,kind,delta,delta)
     if(!changed.changes)throw new Error('Not enough remaining uses or quota cap exceeded.')
     audit(req.userId!,req.params.id,'usage_quota',JSON.stringify({kind,delta,reason}))
     return purchasedQuota(req.params.id,kind)
   }).immediate()
   res.json({ok:true,remaining})
 }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Could not update usage.'})}
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
  catch(error) { refundAI((req as AuthRequest).userId!,creditRef); console.error('Generation error',error); res.status(502).json({ error: publicAiError(error) }) }
})
app.post('/api/ai/edit',requireAuth, singleFlight('edit'), aiBudgetGuard('edit'), async (req,res) => {
  const parsed = editBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error:'Please provide an edit instruction and valid existing website code.' })
  const creditRef=reserveOrReject(req as AuthRequest,res,'edit')
  if (!creditRef) return
  try { const code = await editWebsite(parsed.data.instruction,parsed.data.code); res.json({ code, creditsRemaining:getCredits((req as AuthRequest).userId!) }) }
  catch(error) { refundAI((req as AuthRequest).userId!,creditRef); console.error('Edit error',error); res.status(502).json({ error: publicAiError(error) }) }
})


// AI Studio: isolated, account-owned conversations and opt-in local plugins.
const studioMessage = z.object({searchWeb:z.boolean().default(false),message:z.string().trim().min(1).max(6000), pluginIds:z.array(z.enum(['seo-audit','accessibility','project-map','launch-checklist'])).max(4).default([]), projectCode:safeCode.optional()})
const threadIdSchema = z.string().uuid()
const ownsThread = (id:string, userId:string) => !!db.prepare('SELECT 1 FROM ai_threads WHERE id=? AND user_id=?').get(id,userId)
const serializeThread = (row:any) => ({id:row.id,title:row.title,createdAt:row.created_at,updatedAt:row.updated_at})
// Account-owned, opt-in pinned memory. Users can inspect/delete every entry.
const memoryContent=z.string().trim().min(3).max(500)
app.get('/api/studio/memory',requireAuth,(req:AuthRequest,res)=>{
  const rows=db.prepare('SELECT id,content,created_at FROM studio_memories WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.userId) as {id:string;content:string;created_at:string}[]
  res.json({memories:rows.map(x=>({id:x.id,content:x.content,createdAt:x.created_at}))})
})
app.post('/api/studio/memory',requireAuth,(req:AuthRequest,res)=>{
  const parsed=z.object({content:memoryContent}).safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Memory must contain 3–500 characters.'})
  const count=(db.prepare('SELECT COUNT(*) AS n FROM studio_memories WHERE user_id=?').get(req.userId) as {n:number}).n
  if(count>=50)return res.status(400).json({error:'Memory limit reached (50). Delete an old entry first.'})
  const id=randomUUID(),stamp=now()
  db.prepare('INSERT INTO studio_memories(id,user_id,content,created_at) VALUES(?,?,?,?)').run(id,req.userId,parsed.data.content,stamp)
  res.status(201).json({memory:{id,content:parsed.data.content,createdAt:stamp}})
})
app.delete('/api/studio/memory/:id',requireAuth,(req:AuthRequest,res)=>{
  if(!z.string().uuid().safeParse(req.params.id).success)return res.status(404).json({error:'Memory not found.'})
  const result=db.prepare('DELETE FROM studio_memories WHERE id=? AND user_id=?').run(req.params.id,req.userId)
  if(!result.changes)return res.status(404).json({error:'Memory not found.'})
  res.json({ok:true})
})
// Context retrieval is bounded, user-scoped, and never queries other accounts.
function priorStudioContext(userId:string,currentThreadId:string,query:string):string[]{
  const candidates=db.prepare(`SELECT m.role,m.content,t.title FROM ai_thread_messages m
    JOIN ai_threads t ON t.id=m.thread_id
    WHERE t.user_id=? AND t.id<>?
    ORDER BY m.created_at DESC LIMIT 150`).all(userId,currentThreadId) as {role:string;content:string;title:string}[]
  const stop=new Set(['what','where','about','that','this','ليش','شو','انا','انت','مين','كيف','عندي','هاي','هذا','اللي'])
  const words=new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!stop.has(w)))
  const ranked=candidates.map((c,i)=>({value:c.role+': '+c.content,score:[...words].filter(w=>(c.content+' '+c.title).toLowerCase().includes(w)).length,order:i}))
    .sort((a,b)=>b.score-a.score || a.order-b.order)
  // Even vague questions ("what did we discuss?", "who am I?") get some
  // bounded, recent context from this account instead of an empty memory.
  return ranked.slice(0,12).map(c=>c.value.slice(0,450))
}
function rememberStudioFact(userId:string,message:string):void {
  // Keep only user-stated durable project identity/preferences. No inferred
  // sensitive traits; a user can inspect and delete all entries.
  const text=message.trim().slice(0,500)
  const patterns=[
    /(?:اسم\s+(?:شركتي|مشروعي|البراند|الموقع)|شركتي\s+اسمها|مشروعي\s+اسمه|my\s+(?:company|brand|business)\s+(?:is|name\s+is))\s*[:：\-]?\s*([^\n.!؟]{2,100})/iu,
    /(?:بفضّل|افضل|بحب|ما\s+بحب|i\s+prefer|i\s+like|i\s+don't\s+like)\s+([^\n.!؟]{3,100})/iu,
    /(?:تذكر|احفظ|خليك\s+متذكر|remember\s+that)\s*[:：\-]?\s*(.{3,180})/iu
  ]
  const matches=patterns.map(p=>text.match(p)).filter((m):m is RegExpMatchArray=>Boolean(m))
  for(const match of matches.slice(0,2)){
    const fact=match[0].trim().slice(0,220)
    if(fact.length<7 || /(password|passwords|كلمة\s*السر|api.?key|secret|token|بطاقة|credit.card|رقم\s*الهويه|مرض|عنوان\s*بيتي|ديني|سياسي|جنس)/iu.test(fact))continue
    const exists=db.prepare('SELECT 1 FROM studio_memories WHERE user_id=? AND content=?').get(userId,fact)
    if(exists)continue
    const count=(db.prepare('SELECT COUNT(*) AS n FROM studio_memories WHERE user_id=?').get(userId) as {n:number}).n
    if(count>=50)break
    db.prepare('INSERT INTO studio_memories(id,user_id,content,created_at) VALUES(?,?,?,?)').run(randomUUID(),userId,fact,now())
  }
}

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
    const memories=db.prepare('SELECT content FROM studio_memories WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.userId) as {content:string}[]
    const priorConversation=priorStudioContext(req.userId!,req.params.id,message)
    const reply=await chatWithStudio([...history.reverse(),{role:'user',content:message}],reports,projectCode ? `Title: ${projectCode.title}; description: ${projectCode.description}; pages: ${Object.keys(projectCode.pages||{'index.html':projectCode.html}).join(', ')}; files: ${Object.keys(projectCode.files||{}).join(', ')}`:undefined,{memoryItems:memories.map(m=>m.content),priorConversation})
    const stamp=now(), userId=randomUUID(),assistantId=randomUUID()
    db.transaction(()=>{
      db.prepare('INSERT INTO ai_thread_messages(id,thread_id,role,content,created_at) VALUES (?,?,?,?,?)').run(userId,req.params.id,'user',message,stamp)
      db.prepare('INSERT INTO ai_thread_messages(id,thread_id,role,content,created_at) VALUES (?,?,?,?,?)').run(assistantId,req.params.id,'assistant',reply,stamp)
      const title = count===0 ? message.slice(0,72) : undefined
      if(title) db.prepare('UPDATE ai_threads SET title=?,updated_at=? WHERE id=?').run(title,stamp,req.params.id)
      else db.prepare('UPDATE ai_threads SET updated_at=? WHERE id=?').run(stamp,req.params.id)
    })()
    // Memory extraction must never invalidate a successful chat response.
    try {rememberStudioFact(req.userId!,message)} catch(error){console.warn('Automatic memory extraction skipped',error)}
    res.json({reply,pluginReports:reports})
  } catch(e) {refundAI(req.userId!,creditRef);console.error('Studio AI failed',e);res.status(502).json({error:publicAiError(e)})}
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

// Staging media library. Uploads are restricted to genuine supported media signatures,
// bounded per-account, and distributed only via unguessable UUID paths.
// The raw media URL is shareable; never upload confidential files.
const assetMime=z.enum(['image/png','image/jpeg','image/webp','image/gif','audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm'])
const mediaUpload=z.object({filename:z.string().min(1).max(120),mime:assetMime,dataBase64:z.string().min(16).max(4_200_000)})
const maxMediaBytes=3*1024*1024
function matchesMedia(mime:string,buf:Buffer):boolean {
  const ascii=(s:number,n:number)=>buf.subarray(s,s+n).toString('ascii')
  if(mime==='image/png') return buf.length>=8 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if(mime==='image/jpeg') return buf.length>=4 && buf[0]===255&&buf[1]===216&&buf[2]===255
  if(mime==='image/gif') return ascii(0,4)==='GIF8' && (buf[4]===0x37||buf[4]===0x39)
  if(mime==='image/webp') return ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'
  if(mime==='audio/wav') return ascii(0,4)==='RIFF'&&ascii(8,4)==='WAVE'
  if(mime==='audio/ogg') return ascii(0,4)==='OggS'
  if(mime==='audio/mpeg') return ascii(0,3)==='ID3' || (buf.length>3&&buf[0]===255&&(buf[1]&0xe0)===0xe0)
  if(mime==='video/mp4') return ascii(4,4)==='ftyp'
  if(mime==='video/webm') return buf.length>=4 && buf.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
  return false
}
const publicMediaId=z.string().uuid()
const assetSelect='SELECT id,filename,mime,size_bytes,created_at FROM media_assets WHERE user_id=? ORDER BY created_at DESC'
app.get('/api/media',requireAuth,(req:AuthRequest,res)=>{
  const rows=db.prepare(assetSelect).all(req.userId) as {id:string;filename:string;mime:string;size_bytes:number;created_at:string}[]
  res.json({assets:rows.map(a=>({id:a.id,name:a.filename,mime:a.mime,size:a.size_bytes,url:`/media/${a.id}`,createdAt:a.created_at}))})
})
app.post('/api/media',requireAuth,rateLimit({windowMs:60_000,limit:10,standardHeaders:'draft-7',legacyHeaders:false}),(req:AuthRequest,res)=>{
  const parsed=mediaUpload.safeParse(req.body)
  if(!parsed.success) return res.status(400).json({error:'Invalid media file. Maximum 3 MB. PNG, JPG, WebP, GIF, MP3, WAV, OGG, MP4 and WebM only.'})
  const {filename,mime,dataBase64}=parsed.data
  if(!/^[a-zA-Z0-9_. ()-]+$/.test(filename)||filename.startsWith('.')) return res.status(400).json({error:'Rename the file using letters, numbers and standard punctuation.'})
  if(!/^[a-zA-Z0-9+/]+={0,2}$/.test(dataBase64)||dataBase64.length%4!==0) return res.status(400).json({error:'Invalid media encoding.'})
  const data=Buffer.from(dataBase64,'base64')
  if(data.length===0||data.length>maxMediaBytes||!matchesMedia(mime,data)) return res.status(400).json({error:'Media size or file signature does not match the selected type.'})
  const existing=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS bytes FROM media_assets WHERE user_id=?').get(req.userId) as {count:number;bytes:number}
  if(existing.count>=20 || existing.bytes+data.length>30*1024*1024) return res.status(413).json({error:'Media library limit reached (20 files or 30 MB total).'})
  const id=randomUUID(),stamp=now()
  db.prepare('INSERT INTO media_assets(id,user_id,filename,mime,size_bytes,data_base64,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,req.userId,filename,mime,data.length,dataBase64,stamp)
  res.status(201).json({asset:{id,name:filename,mime,size:data.length,url:`/media/${id}`,createdAt:stamp}})
})
app.delete('/api/media/:id',requireAuth,(req:AuthRequest,res)=>{
  if(!publicMediaId.safeParse(req.params.id).success) return res.status(404).json({error:'Media not found.'})
  const result=db.prepare('DELETE FROM media_assets WHERE id=? AND user_id=?').run(req.params.id,req.userId)
  if(!result.changes) return res.status(404).json({error:'Media not found.'})
  res.json({ok:true})
})
app.get('/media/:id',(req,res)=>{
  if(!publicMediaId.safeParse(req.params.id).success) return res.status(404).send('Not found.')
  const row=db.prepare('SELECT mime,data_base64,size_bytes FROM media_assets WHERE id=?').get(req.params.id) as {mime:string;data_base64:string;size_bytes:number}|undefined
  if(!row) return res.status(404).send('Not found.')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Cache-Control','public,max-age=300')
  res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox")
  res.setHeader('Content-Disposition','inline')
  res.type(row.mime).send(Buffer.from(row.data_base64,'base64'))
})

// Direct publishing: a public snapshot is served by VELQOZA AI itself.
// Generated code always runs in a CSP-sandboxed opaque origin so it cannot read
// the VELQOZA app's localStorage/auth tokens, even though it shares a hostname.
const publishSlug = z.string().regex(/^[a-f0-9]{24}$/)
const siteNameSchema=z.string().min(3).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const reservedSiteNames=new Set(['www','app','ai','admin','api','mail','smtp','imap','pop','ftp','support','help','accounts','login','signup','billing','dashboard','staging','test','demo','preview','cdn','assets','static','ns1','ns2','deploy','status','pay','payments','checkout','security','auth','oauth','webmail','localhost','velqoza','www2'])
const validSiteName=(value:unknown):value is string=>typeof value==='string' && siteNameSchema.safeParse(value).success && !reservedSiteNames.has(value)
const publicationName=(id:string)=> (db.prepare('SELECT site_name FROM published_site_names WHERE publication_id=?').get(id) as {site_name:string}|undefined)?.site_name || null
const publicationByName=(siteName:string)=>db.prepare(
  'SELECT p.slug FROM published_site_names n JOIN published_sites p ON p.id=n.publication_id WHERE n.site_name=?'
).get(siteName) as {slug:string}|undefined

const publicationRow = (projectId:string,userId:string) => db.prepare(
  'SELECT id,slug,created_at,updated_at FROM published_sites WHERE project_id=? AND user_id=?'
).get(projectId,userId) as {id:string;slug:string;created_at:string;updated_at:string}|undefined
app.get('/api/published/:projectId',requireAuth,(req:AuthRequest,res)=>{
  if (!z.string().uuid().safeParse(req.params.projectId).success) return res.status(400).json({error:'Invalid project ID.'})
  const row=publicationRow(req.params.projectId,req.userId!)
  res.json({publication:row ? {slug:row.slug,siteName:publicationName(row.id),url:publicationName(row.id)?`/sites/${publicationName(row.id)}/index.html`:`/published/${row.slug}/index.html`,updatedAt:row.updated_at} : null})
})
app.get('/api/site-names/check',requireAuth,(req:AuthRequest,res)=>{
  const siteName=String(req.query.name || '').toLowerCase()
  if(!validSiteName(siteName)) return res.json({available:false,reason:'Use 3–40 lowercase letters, numbers and single hyphens; this name may be reserved.'})
  const existing=publicationByName(siteName)
  res.json({available:!existing,reason:existing?'This site name is already taken.':null})
})
app.post('/api/published/:projectId',requireAuth,(req:AuthRequest,res)=>{
  if (!z.string().uuid().safeParse(req.params.projectId).success) return res.status(400).json({error:'Invalid project ID.'})
  const requested=typeof req.body?.siteName==='string'?req.body.siteName.toLowerCase().trim():''
  if(!validSiteName(requested)) return res.status(400).json({error:'Choose a name with 3–40 lowercase letters, numbers, or hyphens. This name may be reserved.'})
  const project=db.prepare('SELECT code_json FROM projects WHERE id=? AND user_id=?').get(req.params.projectId,req.userId) as {code_json:string}|undefined
  if (!project) return res.status(404).json({error:'Save the project first.'})
  const code=safeCode.safeParse(JSON.parse(project.code_json))
  if (!code.success) return res.status(400).json({error:'Project has unsupported content. Review files before publishing.'})
  const existing=publicationRow(req.params.projectId,req.userId!)
  const timestamp=now()
  try {
    const result=db.transaction(()=>{
      // Atomic name ownership check protects concurrent claims and rename races.
      const claimed=db.prepare('SELECT publication_id FROM published_site_names WHERE site_name=?').get(requested) as {publication_id:string}|undefined
      if(claimed && claimed.publication_id!==existing?.id) return {conflict:true} as const
      if(existing){
        db.prepare('UPDATE published_sites SET code_json=?,updated_at=? WHERE id=? AND user_id=?')
          .run(JSON.stringify(code.data),timestamp,existing.id,req.userId)
        const prior=publicationName(existing.id)
        if(prior) db.prepare('UPDATE published_site_names SET site_name=? WHERE publication_id=? AND user_id=?')
          .run(requested,existing.id,req.userId)
        else db.prepare('INSERT INTO published_site_names(site_name,publication_id,user_id,created_at) VALUES(?,?,?,?)')
          .run(requested,existing.id,req.userId,timestamp)
        return {slug:existing.slug,updated:true} as const
      }
      const slug=randomUUID().replace(/-/g,'').slice(0,24)
      const publicationId=randomUUID()
      db.prepare('INSERT INTO published_sites(id,user_id,project_id,slug,code_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(publicationId,req.userId,req.params.projectId,slug,JSON.stringify(code.data),timestamp,timestamp)
      db.prepare('INSERT INTO published_site_names(site_name,publication_id,user_id,created_at) VALUES(?,?,?,?)')
        .run(requested,publicationId,req.userId,timestamp)
      return {slug,updated:false} as const
    })()
    if('conflict' in result) return res.status(409).json({error:'This site name is already taken. Choose another.'})
    return res.status(result.updated?200:201).json({ok:true,slug:result.slug,siteName:requested,url:`/sites/${requested}/index.html`,updated:result.updated,
      subdomainReady:false,desiredSubdomain:`${requested}.velqoza.com`})
  } catch(error) {
    console.error('Publish name reservation failed',error)
    return res.status(409).json({error:'This site name could not be reserved. It may already be taken.'})
  }
})
app.delete('/api/published/:projectId',requireAuth,(req:AuthRequest,res)=>{
  const result=db.prepare('DELETE FROM published_sites WHERE project_id=? AND user_id=?').run(req.params.projectId,req.userId)
  if(!result.changes) return res.status(404).json({error:'Published site not found.'})
  res.json({ok:true})
})
app.get('/published/:slug',(req,res)=>res.redirect(302,`/published/${req.params.slug}/index.html`))
const servePublishedBySlug=(req:express.Request,res:express.Response,slug:string,filename:string)=>{
  if (!publishSlug.safeParse(slug).success) return res.status(404).send('Site not found.')
  req.params.slug=slug
  req.params.filename=filename
  if (!publishSlug.safeParse(req.params.slug).success) return res.status(404).send('Site not found.')
  filename=filename.toLowerCase()
  if (!/^[a-z0-9][a-z0-9_.-]{0,80}$/.test(filename)) return res.status(404).send('File not found.')
  const row=db.prepare('SELECT code_json FROM published_sites WHERE slug=?').get(req.params.slug) as {code_json:string}|undefined
  if(!row) return res.status(404).send('Site is unpublished or not found.')
  let code:SiteCode
  try {code=JSON.parse(row.code_json)} catch {return res.status(503).send('Site data unavailable.')}
  // All published HTML pages are isolated from VELQOZA's privileged app origin.
  const csp="sandbox allow-scripts allow-forms; default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src * data: blob:; media-src * data: blob:; connect-src https:; form-action https:; frame-ancestors 'none'; base-uri 'none'"
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  if(filename==='styles.css'||filename==='style.css'){
    res.type('text/css').send(code.css);return
  }
  if(filename==='script.js'||filename==='main.js'){
    res.type('application/javascript').send(code.js);return
  }
  const pages=code.pages && Object.keys(code.pages).length ? code.pages : {'index.html':code.html}
  if (!Object.prototype.hasOwnProperty.call(pages,filename)) return res.status(404).send('Page not found.')
  const html=pages[filename]
  const css='<link rel="stylesheet" href="styles.css">'
  const js='<script src="script.js"></script>'
  const hasFullDocument=/<!doctype\s+html|<html[\s>]/i.test(html)
  const isHebrew=/[\u0590-\u05FF]/.test(html) || /[\u0590-\u05FF]/.test(code.title)
  const isArabic=/[\u0600-\u06FF]/.test(html) || /[\u0600-\u06FF]/.test(code.title)
  const pageLang=isHebrew?'he':isArabic?'ar':'en'
  const pageDir=(isHebrew||isArabic)?'rtl':'ltr'
  let document=hasFullDocument ? html : `<!doctype html><html lang="${pageLang}" dir="${pageDir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${code.title.replace(/[<>&]/g,'')}</title></head><body>${html}</body></html>`
  // Respect explicit lang/dir attributes on full documents; infer otherwise.
  if(hasFullDocument && !/<html[^>]*\blang=/i.test(document))
    document=document.replace(/<html([\s>])/i,`<html lang="${pageLang}"$1`)
  if(hasFullDocument && !/<html[^>]*\bdir=/i.test(document))
    document=document.replace(/<html([\s>])/i,`<html dir="${pageDir}"$1`)
  document=/<\/head>/i.test(document)?document.replace(/<\/head>/i,css+'</head>'):css+document
  document=/<\/body>/i.test(document)?document.replace(/<\/body>/i,js+'</body>'):document+js
  res.setHeader('Content-Security-Policy',csp)
  res.type('html').send(document)
}
app.get('/published/:slug/:filename',(req,res)=>servePublishedBySlug(req,res,req.params.slug,req.params.filename))
app.get('/sites/:siteName',(req,res)=>res.redirect(302,`/sites/${req.params.siteName}/index.html`))
app.get('/sites/:siteName/:filename',(req,res)=>{
  const name=req.params.siteName.toLowerCase()
  if (!validSiteName(name)) return res.status(404).send('Site not found.')
  const row=publicationByName(name)
  if (!row) return res.status(404).send('Site not found.')
  return servePublishedBySlug(req,res,row.slug,req.params.filename)
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
applyOwnerTenGenerationGrant()
app.listen(port,()=>console.log(`VELQOZA API listening on http://localhost:${port}`))
// Staging-only, explicitly approved one-time copy. The original Render database
// remains the active source; no deletion, cutover, or payment activation occurs.
if(process.env.VELQOZA_MIGRATION_APPROVED==='TRANSFER_EMPTY_TARGET'){
  if(process.env.RENDER_SERVICE_ID!=='srv-dbs3comi0phs73c0s1dg'||process.env.STAGING_INIT_SCHEMA!=='true'){
    console.error('[Migration] Refusing: this is not the isolated staging service.')
  }else{
    const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../scripts/migrate-staging-to-supabase.mjs')
    const child=spawn(process.execPath,[script,'--apply'],{env:process.env,stdio:['ignore','pipe','pipe']})
    child.stdout.on('data',chunk=>console.info('[Migration]',String(chunk).slice(0,7000)))
    child.stderr.on('data',chunk=>console.error('[Migration]',String(chunk).slice(0,7000)))
    child.on('exit',code=>console.info('[Migration] One-time transfer exited with status '+code))
    child.on('error',error=>console.error('[Migration] Process start failed:',error.message))
  }
}
// This never switches the active database. Staging-only, read-only connection test.
void probeSupabaseDatabase()
