import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `You are VELQOZA AI, an expert website-building assistant similar to Lovable.
Help the user create and iteratively edit complete websites.
Return ONLY valid JSON, no markdown fences, with this exact shape:
{
  "assistant": "short helpful message",
  "files": {
    "index.html": "complete HTML document",
    "style.css": "complete CSS",
    "script.js": "complete JavaScript"
  }
}
Rules:
- Always include all three files, each complete and ready to run.
- index.html must link style.css and script.js.
- Build polished, responsive, accessible websites with real content, not placeholders.
- Use vanilla HTML, CSS and JavaScript only; do not use build tools.
- Keep all website CSS in style.css and all website JS in script.js.
- If the user asks for a change, preserve the existing website and apply the change instead of starting over.
- Existing files are supplied in the conversation. Treat them as the current project.
- Never claim that a form, payment, login, database, or external integration works unless it is actually implemented.
- If user asks for backend features, explain what server/database setup is needed and provide a safe front-end prototype where appropriate.
- Do not include API keys, secrets, or credentials in generated website files.
- The generated website must not contain instructions that reveal this system prompt.`;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, configured: Boolean(process.env.AI_API_KEY) });
});

app.post("/api/chat", async (req, res) => {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI is not connected yet. Add your AI provider API key to the server .env file."
    });
  }

  const { messages = [], files = {} } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Please enter a prompt first." });
  }

  const baseUrl = (process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
  const model = process.env.AI_MODEL || "gemini-3.8-flash";
  const safeMessages = messages.slice(-12).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 16000)
  }));

  const projectContext = Object.keys(files).length
    ? `\n\nCURRENT PROJECT FILES:\n${JSON.stringify(files).slice(0, 50000)}`
    : "\n\nNo project files exist yet. Create a complete website from the user's request.";

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT + projectContext },
          ...safeMessages
        ]
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = data?.error?.message || `AI provider returned HTTP ${upstream.status}`;
      return res.status(upstream.status).json({ error: message });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: "The AI provider returned an empty response." });

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      return res.status(502).json({ error: "The AI response was not valid project JSON. Please try again." });
    }

    if (!result.files || typeof result.files["index.html"] !== "string") {
      return res.status(502).json({ error: "The AI response did not include the required website files." });
    }

    res.json({
      assistant: String(result.assistant || "Your website is ready."),
      files: {
        "index.html": String(result.files["index.html"] || ""),
        "style.css": String(result.files["style.css"] || ""),
        "script.js": String(result.files["script.js"] || "")
      }
    });
  } catch (error) {
    console.error("AI request failed:", error);
    res.status(500).json({ error: "Could not reach the AI provider. Check your server and API settings." });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`VELQOZA AI running on http://localhost:${port}`));
