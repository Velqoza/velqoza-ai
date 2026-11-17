# VELQOZA AI + Supabase Free — verified setup (2026-11-14)

## Already completed
- Existing Supabase project: `vjrbmikievhrkfbkngkr` (`velqoza`).
- Applied an additive migration creating **20 tables** in private schema `velqoza_ai`, separate from the existing `public` schema.
- Verified that `velqoza_ai.users`, `projects` and `package_payments` start empty.
- Explicitly revoked schema and table access from `PUBLIC`, `anon` and `authenticated`. The application backend must connect as a privileged database role; browser clients never connect directly.
- No changes to existing VELQOZA public tables, existing PayPal payment site, or live payouts.
- The database schema is SHARED within an existing Supabase project, **not a new independent project**, so storage/compute quotas and project availability are shared with the original website.

## Still required — do not call the app migrated yet
1. In Supabase project's **Connect** menu select **Session pooler** (not Transaction pooler). This is necessary for IPv4 Render and the backend's per-session `SET search_path`.
2. Set `DATABASE_URL` on the correct **new VELQOZA AI production app service** through Render's private Environment settings. Paste the exact Supabase Session pooler URI with the actual database password directly in Render. Never paste the password/URI into a chat, GitHub, or frontend. URL-encode reserved password characters.
3. Start the NEW monorepo version on its own staging/preproduction deployment first; do not point the current `main` app at the shared Supabase DB blindly. Back up original users/projects. The original production `main` currently runs `node server.js`, not the new TypeScript backend.
4. Verify DB read/write, users, projects, email, AI, credit accounting, webhook event persistence and restart durability using separate test user accounts. Migration of prior accounts/projects is not complete.
5. Finalize provisional package prices and refund workflow. Register the Live PayPal webhook URL and its ID, validate all event signatures, and audit charge/capture edge cases before enabling customer payments.
6. Do not enable `ENABLE_LIVE_PAYMENTS` or `LIVE_PAYMENTS_APPROVED` yet. Keep both `false`. Live credentials must only be set by the authorized merchant via Render's private Environment settings.
7. Link `ai.velqoza.com` only after the app is truly ready and the new app's DNS/TLS setup is verified.

## Important caution
Supabase Free may pause inactive projects and enforces shared usage quotas. Plan periodic backups of active customer/payment data before launch. Initial database setup alone is **not** a completed Render integration.

Official connection guide: https://supabase.com/docs/guides/database/connecting-to-postgres
