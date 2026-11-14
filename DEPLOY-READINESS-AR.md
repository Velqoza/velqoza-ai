# VELQOZA AI — private production preparation

## What has been prepared
- The target Supabase project `velqoza` already contains the *private* `velqoza_ai` PostgreSQL schema (10 RLS-enabled tables, with no grants to anon/authenticated/service_role).
- The server can select PostgreSQL via DATABASE_URL while retaining SQLite for local testing.
- Express serves the compiled Vite frontend from one origin in production.
- A non-destructive SQLite-to-PostgreSQL migration CLI is provided.
- `render.yaml` provides Render build/runtime metadata, **not** an automatic deployment.

## STOP before release
1. **Latest DB needed:** The snapshot in the previous private Account Control ZIP may be older than your current local DB. Stop VELQOZA AI, back up the latest data/velqoza.sqlite (and WAL/SHM if present). Use only a consistent latest snapshot for migration.
2. **Supply private environment variables on Render:** DATABASE_URL = Supabase pooler PostgreSQL URI with password from Supabase Connect (keep secret), JWT_SECRET = current stable secret to preserve existing login tokens (rotate only if compromised), OPENAI_API_KEY, RESEND_API_KEY, ADMIN_EMAIL, CLIENT_ORIGIN=https://ai.velqoza.com, APP_BASE_URL=https://ai.velqoza.com. Never paste secrets into GitHub or commit .env.
3. **Migration:** Run dry-run: `npm run migrate:postgres --workspace server`; then `npm run migrate:postgres --workspace server -- --execute` with DATABASE_URL and SQLITE_SOURCE exported locally. Migrates inserts without replacing any existing cloud records, in one transaction. Verify all account/project/credit counts and sign-ins before traffic is switched.
4. Build and run tests (`npm install`, `npm run build`, `npm test --workspace server`) on a network-enabled machine/CI. This archive was NOT end-to-end deployed or tested with a live PostgreSQL connection.
5. On Render deploy a **private** service/repository first, configure domain and HTTPS, exercise email verify/password reset, projects, credits, banned users, account switch, rate-limit behaviour, and backups. Only then switch public DNS.
6. Payment packages are informational: **purchasesEnabled=false**, no paid webhook/checkout is implemented. Do not take payment until verified payments and refunds are integrated.
7. Review older user tokens stored in browser local storage (account switch); production hardening should use HttpOnly server sessions or secure token rotation and avoid untrusted scripts.

## Limitations
- The PostgreSQL driver here is a low-concurrency compatibility bridge around the old synchronous SQLite API, not a horizontally scalable data layer. For significant public traffic, migrate endpoints to async `pg` with a connection pool and explicit transactions.
- Your currently connected Supabase project is shared with VELQOZA business tables; never disable its API or change grants on `public` without a review.
- Do not import an older SQLite backup to supersede newer source data. Migration intentionally uses ON CONFLICT DO NOTHING, so existing cloud records are preserved.
- This release contains **no secrets and no user database**. Keep your current private backup locally.


## Snapshot recovered from latest user-uploaded project
The latest complete Account Control ZIP was checked on 2026-11-14: **2 user accounts**, **8 projects**, **10 credit ledger entries**, and **2 vouchers**.
The private SQLite backup is kept in a separate file from the public-safe deployment source. The full-stack code in this package is deployment preparation, not a live deployed service.
**Not completed:** live PostgreSQL migration, live connection/health checks, Render deploy, HTTPS/DNS verification, and any real payment integration.

## November 14 readiness update
- Production health now checks a live SQL query instead of returning success when PostgreSQL is unreachable.
- **Never set DATABASE_URL to the main postgres admin account.** Scoped database role credentials stay in Render secret variables only.
- Running the SQLite importer requires a secure DB connection and must precede accepting user writes.
- GitHub/Render public deployment remains blocked until dependency build+tests succeed and actual server secrets are configured.
- Payment checkout remains disabled.
