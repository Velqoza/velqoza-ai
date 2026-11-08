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
