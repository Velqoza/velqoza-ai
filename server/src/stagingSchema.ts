// Idempotent setup ONLY for a fresh, isolated staging PostgreSQL database.
// Never run against the main production database. No drops, truncates, or data imports.
export const stagingSchemaSql = `
CREATE SCHEMA IF NOT EXISTS velqoza_ai;
CREATE TABLE IF NOT EXISTS velqoza_ai.users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_banned INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  display_name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS velqoza_ai.projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES velqoza_ai.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, code_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user_updated ON velqoza_ai.projects(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS velqoza_ai.ai_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES velqoza_ai.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_threads_user_updated ON velqoza_ai.ai_threads(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS velqoza_ai.ai_thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES velqoza_ai.ai_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_messages_thread ON velqoza_ai.ai_thread_messages(thread_id,created_at);
CREATE TABLE IF NOT EXISTS velqoza_ai.ai_usage (
  user_id TEXT NOT NULL REFERENCES velqoza_ai.users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('generate','edit','studio')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,day,kind)
);
CREATE TABLE IF NOT EXISTS velqoza_ai.credit_wallets (
  user_id TEXT PRIMARY KEY REFERENCES velqoza_ai.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)
);
CREATE TABLE IF NOT EXISTS velqoza_ai.credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES velqoza_ai.users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK(delta != 0),
  kind TEXT NOT NULL, reference_id TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_created ON velqoza_ai.credit_ledger(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS velqoza_ai.credit_vouchers (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL CHECK(credits > 0 AND credits <= 100000),
  created_at TEXT NOT NULL, expires_at TEXT,
  redeemed_by TEXT REFERENCES velqoza_ai.users(id), redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS credit_vouchers_expiry ON velqoza_ai.credit_vouchers(expires_at);
CREATE TABLE IF NOT EXISTS velqoza_ai.admin_audit (
  id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, target_user_id TEXT,
  action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_created ON velqoza_ai.admin_audit(created_at DESC);
CREATE TABLE IF NOT EXISTS velqoza_ai.email_auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES velqoza_ai.users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_auth_tokens_user_purpose ON velqoza_ai.email_auth_tokens(user_id,purpose);
`;
