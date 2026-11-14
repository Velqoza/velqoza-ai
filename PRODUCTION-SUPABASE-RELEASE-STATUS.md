# VELQOZA AI — verified Supabase release state (2026-11-15)

## Confirmed and already completed
- The modern React/TypeScript VELQOZA AI runs on isolated Render staging service `srv-dbs3comi0phs73c0s1dg`, branch `staging-production-prep`.
- Staging's **primary** database is Supabase's private `velqoza_ai` schema, selected by `VELQOZA_PRIMARY_DB=supabase` and `STAGING_INIT_SCHEMA=true`. Existing authentication, chat history and project persistence were checked in the staging UI.
- A second private schema, `velqoza_ai_production`, was created with the same 20 tables in the existing Supabase project, without buying another database.
- A transactional **snapshot** of all 20 source tables was copied into `velqoza_ai_production` with nonempty-target rejection and per-table row-count checks. At copy time: 2 users, 1 project, 4 chat threads, 20 messages and 2 credit wallets. Live staging can acquire *new writes after the snapshot*, which are **not automatically mirrored**.
- Confirmed neither `anon` nor `authenticated` Postgres roles have USAGE on either private schema.
- The PostgreSQL worker supports an allowlisted `VELQOZA_DB_SCHEMA`. The new production deployment must select `velqoza_ai_production`, not the staging schema.
- PayPal Live is still OFF. Existing Supabase legacy PayPal webhook must remain unchanged.

## Safe production environment (on a NEW modern production deployment)
These are variable **names/values** only, not credentials:

```text
NODE_ENV=production
VELQOZA_PRIMARY_DB=supabase
VELQOZA_DB_SCHEMA=velqoza_ai_production
STAGING_INIT_SCHEMA=false
CLIENT_ORIGIN=https://ai.velqoza.com
ENABLE_LIVE_PAYMENTS=false
LIVE_PAYMENTS_APPROVED=false
```

Required backend-only **secrets**: `SUPABASE_DATABASE_URL` (verified Supabase session pooler port 5432), `SUPABASE_CA_CERT`, `JWT_SECRET`, `OPENAI_API_KEY`; also applicable email-provider credentials. Do not place secrets in GitHub, URLs, screenshots, chat or frontend. Payment credentials and a distinct webhook ID are required later.

## Remaining release gates
1. **Do not merge the staging branch into main yet.** Legacy Render production uses different build/start commands and is auto-deployed from `main`. Save its exact deployment config and verify whether any legacy data requires preservation.
2. Configure a separate Render production service using the modern branch, with build command `npm ci --include=dev --no-audit --no-fund && npm run build`, start command `npm start`, health path `/api/health`, and private environment values above. Do not enable staging schema initialization.
3. Before allowing customer traffic, freeze writes to old active staging, recheck the full row counts and any data changes since this snapshot. Reconcile changes into production safely, *without* destructive overwrite.
4. Verify real production health, existing-account logins, session persistence, project creation/save/reload, chat history, balances and AI usage. Production and staging must not write to each other's schemas.
5. Connect `ai.velqoza.com` to the verified modern service and confirm HTTPS/TLS and correct client origin.
6. Merchant-approved PayPal Live integration: separate webhook to `https://ai.velqoza.com/api/paypal/webhook`, verified refund/dispute monitoring, terms, prices, checkout failure/recovery/idempotency tests and adult account-owner approval. Only then turn on checkout flags.
7. Keep the previous production app and staging Render database accessible for rollback until the release is independently verified.

## Rollback
If the modern production deployment fails, keep the old production deployment live, disable live checkout and redirect customer traffic only after verifying the previous system's state. Never swap the production DB to staging's `velqoza_ai` schema just to make a deployment pass.

This document tracks checked engineering state; it does not certify the merchant account, public DNS, production data cutover or real-money PayPal readiness.
