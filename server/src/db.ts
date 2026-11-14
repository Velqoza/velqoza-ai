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
const configuredPath = process.env.DATABASE_PATH?.trim()
const hasCustomPath = !!configuredPath && configuredPath !== './data/velqoza.sqlite' && configuredPath !== 'data/velqoza.sqlite'
const dbPath = hasCustomPath
  ? path.resolve(projectRoot, configuredPath!)
  : (databaseScore(legacyServer) > databaseScore(legacyRoot) ? legacyServer : legacyRoot)
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL && !hasCustomPath) throw new Error('Set an explicit, persistent DATABASE_PATH for production.')
if (!process.env.DATABASE_URL) fs.mkdirSync(path.dirname(dbPath), { recursive: true })
console.log(`[VELQOZA] Project database: ${dbPath}`)
export const db = (process.env.DATABASE_URL ? new PostgresDatabase(process.env.DATABASE_URL) : new Database(dbPath)) as Database.Database
if (process.env.DATABASE_URL) {
  console.log('[VELQOZA] Persistent PostgreSQL enabled (private velqoza_ai schema).')
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

}
