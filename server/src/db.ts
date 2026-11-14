import './loadEnv.js'
import Database from 'better-sqlite3'
import { PostgresDatabase } from './pgSync.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Keep the database stable even when the server is launched from a different folder.
// Existing VELQOZA builds used both <project>/data and <project>/server/data.
// Choose the existing database with the most saved projects; never overwrite either.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../')
const legacyRoot = path.resolve(projectRoot, 'data/velqoza.sqlite')
const legacyServer = path.resolve(projectRoot, 'server/data/velqoza.sqlite')
function databaseScore(filename: string): number {
  if (!fs.existsSync(filename)) return -1
  try {
    const existing = new Database(filename, { readonly: true, fileMustExist: true })
    try {
      const tables = existing.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','projects')").all() as {name:string}[]
      const names = new Set(tables.map(row => row.name))
      const users = names.has('users') ? (existing.prepare('SELECT COUNT(*) AS n FROM users').get() as {n:number}).n : 0
      const projects = names.has('projects') ? (existing.prepare('SELECT COUNT(*) AS n FROM projects').get() as {n:number}).n : 0
      return projects * 1000000 + users
    } finally { existing.close() }
  } catch (error) {
    console.warn(`[VELQOZA] Existing database could not be inspected: ${filename}`, error)
    return -1
  }
}
// Staging-only cutover to the already configured Supabase secret. Fail closed.
const useSupabasePrimary = process.env.VELQOZA_PRIMARY_DB === 'supabase'
if(useSupabasePrimary){
  if(process.env.RENDER_SERVICE_ID!=='srv-dbs3comi0phs73c0s1dg'||process.env.STAGING_INIT_SCHEMA!=='true')
    throw new Error('Supabase cutover must be tested on the isolated staging service.')
  const raw=process.env.SUPABASE_DATABASE_URL?.trim()
  if(!raw)throw new Error('SUPABASE_DATABASE_URL is missing; no fallback to Render.')
  const url=new URL(raw)
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.pooler.supabase.com')||url.port!=='5432')
    throw new Error('Supabase primary requires the Session pooler on port 5432.')
  if(!process.env.SUPABASE_CA_CERT?.includes('BEGIN CERTIFICATE'))
    throw new Error('Verified Supabase TLS CA missing.')
}
const activeDatabaseUrl = useSupabasePrimary ? process.env.SUPABASE_DATABASE_URL!.trim() : process.env.DATABASE_URL?.trim()
const configuredPath = process.env.DATABASE_PATH?.trim()
const hasCustomPath = !!configuredPath && configuredPath !== './data/velqoza.sqlite' && configuredPath !== 'data/velqoza.sqlite'
const dbPath = hasCustomPath
  ? path.resolve(projectRoot, configuredPath!)
  : (databaseScore(legacyServer) > databaseScore(legacyRoot) ? legacyServer : legacyRoot)
if (process.env.NODE_ENV === 'production' && !activeDatabaseUrl && !hasCustomPath) throw new Error('Set an explicit, persistent DATABASE_PATH for production.')
if (!activeDatabaseUrl) fs.mkdirSync(path.dirname(dbPath), { recursive: true })
console.log(`[VELQOZA] Project database: ${dbPath}`)
export const db = (activeDatabaseUrl ? new PostgresDatabase(activeDatabaseUrl) : new Database(dbPath)) as Database.Database
if (activeDatabaseUrl) {
  console.log(useSupabasePrimary?'[VELQOZA] Supabase PostgreSQL PRIMARY enabled (private velqoza_ai schema).':'[VELQOZA] Persistent PostgreSQL enabled (private velqoza_ai schema).')
} else {
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, code_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user_updated ON projects(user_id, updated_at DESC);
`)

// AI Studio threads belong to the signed-in account, not the public website.
db.exec(`
CREATE TABLE IF NOT EXISTS ai_threads (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_threads_user_updated ON ai_threads(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS ai_thread_messages (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_messages_thread ON ai_thread_messages(thread_id, created_at);
`)

// Database-backed per-account AI request allowance; rows persist across restarts.
db.exec(`
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('generate','edit','studio')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,day,kind)
);
`)

// Credits are an internal metering unit. They are NOT payment confirmations.
// All mutations run server-side, and the ledger allows auditing and reversals.
db.exec(`
CREATE TABLE IF NOT EXISTS credit_wallets (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)
);
CREATE TABLE IF NOT EXISTS credit_ledger (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 delta INTEGER NOT NULL CHECK(delta != 0),
 kind TEXT NOT NULL,
 reference_id TEXT UNIQUE,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);
`)

// One-time prepaid codes: only the operator can create them from the server CLI.
// Never store usable codes in plaintext. A code is redeemable at most once.
db.exec(`
CREATE TABLE IF NOT EXISTS credit_vouchers (
 id TEXT PRIMARY KEY,
 code_hash TEXT NOT NULL UNIQUE,
 credits INTEGER NOT NULL CHECK(credits > 0 AND credits <= 100000),
 created_at TEXT NOT NULL,
 expires_at TEXT,
 redeemed_by TEXT REFERENCES users(id),
 redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS credit_vouchers_expiry ON credit_vouchers(expires_at);
`)

// Safe schema migration: existing users/projects/wallets are retained.
const userColumns = db.prepare('PRAGMA table_info(users)').all() as {name:string}[]
if (!userColumns.some(c=>c.name==='is_banned')) db.exec('ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0')
db.exec(`CREATE TABLE IF NOT EXISTS admin_audit (
 id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, target_user_id TEXT,
 action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at DESC);`)

db.exec(`CREATE TABLE IF NOT EXISTS site_announcements (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);`)
// Only accounts created after this migration require verification. Existing accounts are
// grandfathered to avoid locking out the owner's projects and prepaid balances.
const verificationColumns=db.prepare('PRAGMA table_info(users)').all() as {name:string}[]
if (!verificationColumns.some(c=>c.name==='email_verified')) db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1')
if (!verificationColumns.some(c=>c.name==='token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0')
if (!verificationColumns.some(c=>c.name==='display_name')) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
db.exec(`CREATE TABLE IF NOT EXISTS email_auth_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_auth_tokens_user_purpose ON email_auth_tokens(user_id,purpose);`)

// Published sites are saved snapshots, never executable backend projects.
db.exec(`
CREATE TABLE IF NOT EXISTS published_sites (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
 slug TEXT NOT NULL UNIQUE,
 code_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS published_sites_user ON published_sites(user_id);
`)

// Friendly names are separate to preserve existing publication IDs and legacy links.
db.exec(`
CREATE TABLE IF NOT EXISTS published_site_names (
 site_name TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL UNIQUE REFERENCES published_sites(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL
);
`)

// Private owner upload; media is served via a high-entropy unguessable URL for
// preview/public sites. Never store active HTML/SVG or executable files here.
db.exec(`
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_assets_user_created ON media_assets(user_id,created_at DESC);
`)

// User-controlled AI Studio memory, isolated per account.
db.exec(`
CREATE TABLE IF NOT EXISTS studio_memories (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_memories_owner ON studio_memories(user_id,created_at DESC);
`)

// Sliding 2-hour allowance; old daily AI usage rows are retained for audit.
db.exec(`
CREATE TABLE IF NOT EXISTS ai_window_usage (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('generate','edit','studio')),
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_window_usage_user_kind_time ON ai_window_usage(user_id,kind,created_at_ms);
`)

// Quote requests only. Never fulfill credits/usage on a request submission.
db.exec(`
CREATE TABLE IF NOT EXISTS package_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 selection_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS package_requests_owner ON package_requests(user_id,created_at DESC);
`)

// Purchased usage quotas are separate from wallet Credits and rolling limits.
db.exec(`
CREATE TABLE IF NOT EXISTS usage_quotas (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('studio','edit','generate')),
 remaining INTEGER NOT NULL DEFAULT 0 CHECK(remaining>=0),
 PRIMARY KEY(user_id,kind)
);
CREATE TABLE IF NOT EXISTS package_payments (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL UNIQUE REFERENCES package_requests(id) ON DELETE CASCADE,
 paypal_order_id TEXT UNIQUE,
 paypal_capture_id TEXT UNIQUE,
 amount_cents INTEGER NOT NULL,
 currency TEXT NOT NULL,
 selection_json TEXT NOT NULL,
 status TEXT NOT NULL,
 created_at TEXT NOT NULL,
 fulfilled_at TEXT
);
CREATE INDEX IF NOT EXISTS package_payments_owner ON package_payments(user_id,created_at DESC);
`)

// Receipt lets a failed AI request restore purchased quota only once.
db.exec(`
CREATE TABLE IF NOT EXISTS quota_reservations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 refunded INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
`)

// Only verified PayPal webhook events are recorded here; event IDs are unique.
db.exec(`
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  capture_id TEXT,
  payment_id TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_events_capture ON payment_webhook_events(capture_id);
`)

}
