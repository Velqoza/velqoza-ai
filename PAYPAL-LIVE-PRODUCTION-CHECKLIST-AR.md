# VELQOZA AI — production release gate (PayPal Live)

**Current state:** Production is not updated by this file. The staging branch is separate from Render's `main` branch, and Live payments must remain off until every gate is met.

## Why this is not a simple merge
- The original Render production service uses `node server.js` and `npm install`.
- Staging is a TypeScript monorepo that requires `npm ci --include=dev --no-audit --no-fund && npm run build`, then `npm start`.
- Staging's PostgreSQL schema is created only when `STAGING_INIT_SCHEMA=true`; **never** enable that flag on production.
- Production must use its own persistent database, migrated/provisioned after confirming user/project data and backups. `velqoza_ai` schema must exist before starting production. Do not point production at staging's database.
- The original GitHub `main` has a substantially different app. Back up the current production deployment and data before changing `main`.

## Required release work
1. Verify production's data persistence, existing users, project counts, backups, SSL, and rollback procedure. Inventory any incompatible user passwords/sessions and test migration using a copied, anonymized database first.
2. Provision a separate persistent production PostgreSQL instance; apply a reviewed migration and verify all required tables, FK relationships and indexes without dropping existing data.
3. Configure the production Render build/start commands; verify health, registration/email, project saving, AI generation/edit/chat, wallet and quotas before allowing checkout.
4. Confirm business owner and account eligibility. Settle the provisional package and unit prices, refunds policy, chargeback/dispute procedure and customer terms.
5. Set production Render secrets `PAYPAL_ENV=live`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` using the existing authorized VELQOZA Live merchant app. Do not paste secrets into chat or GitHub.
6. Configure a *separate* PayPal webhook URL under VELQOZA AI's final production hostname, for example `https://ai.velqoza.com/api/paypal/webhook`, and subscribe to relevant capture refund/reversal and dispute events. Never redirect that webhook to the existing `pay.velqoza.com` handler.
7. Verified webhooks are recorded idempotently. Refund/reversal/dispute events flag related purchases as `review_required`; **they do not yet automatically revoke benefits or issue refunds.** Add a documented manual reconciliation/admin workflow prior to selling packages.
8. Exercise failed checkout, canceled checkout, completed capture, missed return, provider timeout and duplicated webhook. Confirm exact amount/currency, one-time fulfillment, and recovery after server restart. Do not perform an unauthorized real-money test charge.
9. Keep `ENABLE_LIVE_PAYMENTS` and `LIVE_PAYMENTS_APPROVED` unset/false until signed off by the authorized adult merchant and production operator. The app deliberately rejects Live checkout unless both flags are `true`, `PAYPAL_ENV=live`, valid Live credentials, and `STAGING_INIT_SCHEMA` is not `true`.
10. Finally, after PayPal is verified, connect `ai.velqoza.com` to the intended Render production service and verify TLS and return URLs.

**Important:** `STAGING_INIT_SCHEMA` is a testing-only switch, not a database migration tool. The live payment capability is a *prepared integration*, not authorization to accept customer funds today.
