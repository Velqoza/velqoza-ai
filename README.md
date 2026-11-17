# VELQOZA AI

A full-stack AI website builder foundation: React + TypeScript + Tailwind, Express API, OpenAI Responses API, SQLite project storage, JWT authentication, live sandboxed preview, iterative AI edits, and ZIP/source export.

## Requirements
- Node.js 20+
- npm 10+
- An OpenAI API key with access to the model configured in `OPENAI_MODEL`

## Run locally
1. Copy `.env.example` to `server/.env` and set `OPENAI_API_KEY` and a strong `JWT_SECRET`.
2. Install dependencies: `npm install`
3. Start both apps: `npm run dev`
4. Open http://localhost:5173

The API listens on http://localhost:8787. The Vite dev server proxies `/api` to it.

## AI integration
The server calls the OpenAI Responses API and requests a strict JSON Schema response containing `html`, `css`, `js`, `title`, and `description`. Generation and edits are real model calls; there is no mock generation fallback. If the key is missing or the model call fails, the UI displays the server error.

API reference: https://developers.openai.com/api/reference/resources/responses/methods/create
Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs

## Accounts and projects
- Email/password signup and login are implemented with bcrypt password hashing and signed JWTs. Website generation and editing are available before signup; an account is required to save projects.
- SQLite stores users and projects in `server/data/velqoza.sqlite`.
- The app stores the token in browser localStorage. For a public production launch, move sessions to secure, HttpOnly, SameSite cookies, add email verification/password reset, CSRF protections, backups, and account deletion workflows.
- SQLite is suitable for local development/small deployments. Use managed Postgres for multi-instance production deployments.

## Preview and security notes
The generated site is rendered in a sandboxed iframe (`allow-scripts`, without `allow-same-origin`) to isolate it from the builder origin. The model-generated HTML/CSS/JS is untrusted content. Treat preview code as potentially unsafe, keep the sandbox restrictions, and consider a dedicated isolated preview origin plus CSP and resource allowlists before public launch. Exported websites run outside the builder's sandbox.

## Production checklist
- Set `CLIENT_ORIGIN` to the exact deployed frontend origin.
- Use HTTPS and a strong randomly generated `JWT_SECRET`.
- Configure secrets in your hosting provider, never in frontend environment variables.
- Add request quotas/billing controls and monitoring for AI usage.
- Add managed database, backups, email verification, password reset, abuse reporting, and security review.
- Review generated code and third-party assets before publishing.

## Features
- Prompt-led website generation with category, style, and color preferences
- Desktop/tablet/mobile preview
- AI editing that sends the existing website code as context
- Download HTML, CSS, JS, and a complete ZIP
- Signup/login and persistent saved projects
- Rename, reopen, and delete projects
- Example prompts and responsive SaaS landing page


## Full-stack project export (upgrade)
The AI can now return `extraFiles` alongside root HTML pages, shared CSS, and shared JS. The application retains those extra project source files in the project database and puts them into Export ZIP **at their relative paths** (`server.js`, `package.json`, `server/db.js`, `.env.example`, `tests/...`, etc.). Legacy single-page and multi-page projects still load.

**Important:** The live preview is **frontend-only**. It does not start generated Express servers, install npm dependencies or migrate databases. Backend features require exporting the project, reviewing source and dependencies, configuring only placeholder env vars, and starting the generated server separately in a controlled local environment. A generated admin login is **not automatically secure**; review authentication, session management, CSRF, input validation and tests before production deployment. Never use real customers' data to test AI-generated code.

Run `npm --workspace server run test` for project filename-validation tests after `npm install`.


## Optional OpenAI model selection (production-next)

The React builder, project editor, and AI Studio now offer a shared **AI model** selector. The default ("Standard AI") preserves the currently configured `OPENAI_MODEL` and `OPENAI_WEB_MODEL` behavior. Optional server-approved choices are **GPT-6.1 Sol** (`gpt-6.1-sol`) and **GPT-6 Astra** (`gpt-6-astra`). Do not configure invented `gpt-6.2-*` IDs: use an actual model ID available in your OpenAI API organization.

In the Render service's **Environment** settings, ensure:
- `OPENAI_API_KEY`: secret value configured **only on the server**.
- `OPENAI_MODELS_ENABLED=true` to allow users to select the advanced models. If false, advanced choices are visible but disabled.
- `OPENAI_DAILY_LIMIT=20` and `OPENAI_PER_IP_DAILY_LIMIT=5` (or a stricter value) for basic safeguards.

`GET /api/ai/models` returns the public model catalog without disclosing keys. `POST /api/ai/generate`, `POST /api/ai/edit`, and `POST /api/studio/threads/:id/messages` accept a model ID, validate it on the server, and apply existing authentication and Credits rules. Existing clients sending no model still use the original default.

**API costs:** different models have different token prices, but the existing internal VELQOZA credit prices are unchanged in this initial version. Verify margins and add robust per-account, persistent, monetary/usage limits before opening premium models to untrusted users. Daily limits in this implementation are *in-memory per instance*, not a guaranteed billing cap: they reset on server restart and do not span multiple instances. Also use an OpenAI billing budget/alerts. Model names and availability should be confirmed with current OpenAI API documentation.

The updated feature is on the `staging-production-prep` branch, which is the Render `velqoza-ai-production-next` source branch. That Render service has automatic deployment disabled; publishing still requires a deliberate deploy.

