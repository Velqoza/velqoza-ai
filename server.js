
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

Return ONLY one valid JSON object, without markdown fences:
{
  "assistant": "short helpful message",
  "files": {
    "index.html": "complete HTML document",
    "style.css": "complete CSS",
    "script.js": "complete JavaScript"
  }
}

Rules:
- Always return all three complete files.
- index.html must link to style.css and script.js.
- Create polished, responsive, accessible websites.
- Use vanilla HTML, CSS and JavaScript only.
- Keep CSS in style.css and JavaScript in script.js.
- When editing, preserve the existing project.
- Never invent working backend, payment, login or database features.
- Never include API keys or secrets in generated files.
- Your entire response must be valid JSON.`;

const getBaseUrl = () => (
  process.env.AI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta/openai"
).replace(/\/+$/, "");

const getModel = () => process.env.AI_MODEL || "gemini-3.8-flash";

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.AI_API_KEY),
    model: getModel()
  });
});

// TEMPORARY GEMINI CONNECTION TEST
app.get("/api/test-gemini", async (_req, res) => {
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error: "Missing API key"
    });
  }

  console.log("[TEST] Starting Gemini connection test");

  try {
    const response = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          {
            role: "user",
            content: "Reply with only the word OK."
          }
        ],
        max_tokens: 20,
        reasoning_effort: "low"
      }),
      signal: AbortSignal.timeout(45000)
    });

    const body = await response.text();

    console.log("[TEST] Gemini HTTP status:", response.status);
    console.log("[TEST] Gemini response:", body.slice(0, 1500));

    return res.status(200).json({
      ok: response.ok,
      status: response.status,
      response: body.slice(0, 1500)
    });

  } catch (error) {
    console.error("[TEST] Gemini failed:", error.name, error.message);

    return res.status(200).json({
      ok: false,
      error: error.message
    });
  }
});

// WEBSITE GENERATION
app.post("/api/chat", async (req, res) => {
  const startedAt = Date.now();

  console.log("[AI] New generation request received");

  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "AI API key is not configured."
    });
  }

  const { messages = [], files = {} } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Please enter a prompt first."
    });
  }

  const safeMessages = messages.slice(-8).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 10000)
  }));

  const projectContext = Object.keys(files).length
    ? "\n\nCURRENT PROJECT FILES:\n" +
      JSON.stringify(files).slice(0, 30000)
    : "\n\nNo existing project. Create a complete website.";

  const requestBody = {
    model: getModel(),
    reasoning_effort: "low",
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT + projectContext
      },
      ...safeMessages
    ]
  };

  try {
    console.log("[AI] Sending request to Gemini:", getModel());

    const upstream = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(180000)
    });

    const rawBody = await upstream.text();

    let data;

    try {
      data = JSON.parse(rawBody);
    } catch {
      console.error("[AI] Invalid provider response:", rawBody.slice(0, 1000));

      return res.status(502).json({
        error: "Gemini returned an unreadable response."
      });
    }

    if (!upstream.ok) {
      const message = data?.error?.message || `Gemini HTTP ${upstream.status}`;

      console.error("[AI] Provider error:", message);

      return res.status(502).json({
        error: message
      });
    }

    const content = data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string") {
      console.error("[AI] Empty response:", JSON.stringify(data).slice(0, 1000));

      return res.status(502).json({
        error: "Gemini returned an empty response."
      });
    }

    let result;

    try {
      const cleaned = content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

      result = JSON.parse(cleaned);
    } catch {
      console.error("[AI] Invalid generated JSON:", content.slice(0, 1000));

      return res.status(502).json({
        error: "Gemini generated invalid JSON. Please try again."
      });
    }

    if (
      !result.files ||
      typeof result.files["index.html"] !== "string" ||
      typeof result.files["style.css"] !== "string" ||
      typeof result.files["script.js"] !== "string"
    ) {
      console.error("[AI] Required website files missing");

      return res.status(502).json({
        error: "Gemini did not return all three website files."
      });
    }

    console.log(`[AI] SUCCESS - ${Date.now() - startedAt}ms`);

    return res.json({
      assistant: String(result.assistant || "Your website is ready."),
      files: {
        "index.html": result.files["index.html"],
        "style.css": result.files["style.css"],
        "script.js": result.files["script.js"]
      }
    });

  } catch (error) {
    console.error("[AI] Request failed:", error.name, error.message);

    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({
        error: "Gemini took too long to respond."
      });
    }

    return res.status(502).json({
      error: "Could not reach Gemini. Check server logs."
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`VELQOZA AI running on port ${port}`);
});
