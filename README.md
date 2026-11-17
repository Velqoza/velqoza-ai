# VELQOZA AI

An AI website-builder starter project. Users describe a website, the AI returns complete HTML/CSS/JS files, and the app shows a live preview.

## Important: how it works

This project has a frontend **and** a small Node.js backend. GitHub Pages alone cannot run the backend or securely store an AI API key. Deploy the whole project to a Node.js host such as Render, Railway, or another service that supports Node.

## Run locally

1. Install Node.js 18 or newer.
2. Open this folder in a terminal.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Create a Gemini API key in Google AI Studio, then add it as `AI_API_KEY`. The project is preconfigured to use Gemini's OpenAI-compatible endpoint.
6. The defaults are `https://generativelanguage.googleapis.com/v1beta/openai` and `gemini-3.8-flash`; change them only if you choose another compatible model/provider.
7. Run `npm start`.
8. Open `http://localhost:3000`.

## Deploy

- Push this folder to a GitHub repository.
- Create a new **Web Service** on a Node.js hosting provider and connect the repository.
- Build command: `npm install`
- Start command: `npm start`
- Add environment variables in the host dashboard: `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`.
- Deploy and open the URL provided by the host.


## Choosing GPT-6.2 Sol or Astra

The website builder supports a **model picker** in chat:

- **Gemini** remains the default when `AI_PROVIDER=gemini`.
- **Local Ollama** remains the default when `AI_PROVIDER=ollama`.
- **GPT-6.2 Sol** (`gpt-6.2-sol`) and **GPT-6.2 Astra** (`gpt-6.2-astra`) appear in the picker, but stay disabled until the server owner enables OpenAI.

To enable the two OpenAI models, configure the **backend's environment variables** (for example, Render's Environment settings):

```ini
OPENAI_API_KEY=your_key_from_the_OpenAI_API_dashboard
OPENAI_MODELS_ENABLED=true
OPENAI_DAILY_LIMIT=20
OPENAI_PER_IP_DAILY_LIMIT=5
```

Keep your existing Gemini or Ollama settings unchanged. The browser sends only a selected model **ID** to `POST /api/chat`; the backend validates it against an allowlist and calls the selected provider. OpenAI requests use the Chat Completions API and a strict website JSON schema. The API key remains server-side, never in the frontend or GitHub.

The server advertises models through `GET /api/models`. Disabled models cannot be selected in the browser or requested through the API. The dropdown stores a user's last selected model locally on that browser.

**Spending and public launch warning:** OpenAI API calls are billed separately from ChatGPT subscriptions. By default the server allows at most 20 OpenAI calls/day across all users and 5 per source IP/day. These are conservative **in-memory** limits: they reset on process restart and are not shared between server instances. Before offering paid models publicly, add sign-in, persistent per-account quotas, billing alerts and a hard spend budget. Keep `OPENAI_MODELS_ENABLED=false` until these safeguards are acceptable for your use case.

Run `npm test` to validate the model allowlist, OpenAI request formatting and quota logic. Live testing also requires an active OpenAI API key and access to the chosen models.

## Security

- Never commit `.env`.
- Never place the AI API key in `public/app.js`, HTML, or CSS.
- Add rate limiting, usage limits, and authentication before making the service public. API usage may cost money depending on the provider and model.

## Current MVP features

- AI prompt chat
- Generates complete `index.html`, `style.css`, and `script.js`
- Live preview in a sandboxed iframe
- Basic code editor and apply changes
- Download generated files
- Mobile-responsive builder interface

This is a working starter/MVP, not yet a full Lovable replacement. Project persistence, user accounts, database, secure publishing, billing, and robust file editing still need to be added.
