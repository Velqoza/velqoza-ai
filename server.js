
import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `You are VELQOZA AI, an expert website-building assistant.

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
- Create polished, premium, responsive and accessible websites.
- Use vanilla HTML, CSS and JavaScript only.
- Keep CSS in style.css and JavaScript in script.js.
- When editing, preserve the existing project and modify it.
- Never pretend backend, payment, login or database features work unless implemented.
- Never include API keys or secrets in generated files.
- Generate high-quality websites with efficient, clean code.
- Avoid unnecessarily long code, repeated CSS and duplicated sections.
- Do not use base64 images.
- Use optimized CSS and JavaScript.
- Prioritize visual quality, responsive design and working interactions.
- Keep all three files complete, but avoid unnecessary explanations.
- Return valid JSON only.`;

const getBaseUrl = () =>
  (process.env.AI_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");

const getModel = () => process.env.AI_MODEL || "gemini-3.8-flash";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function extractJson(content) {
  const cleaned = String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }

    throw new Error("AI response did not contain valid JSON.");
  }
}

// RETRY SYSTEM
async function fetchWithRetry(url, options, label = "AI") {
  const delays = [3000, 7000];
  const retryableStatuses = [429, 500, 502, 503, 504];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log(`[${label}] Attempt ${attempt + 1}/3`);

      const response = await fetch(url, options);

      if (
        !response.ok &&
        retryableStatuses.includes(response.status) &&
        attempt < 2
      ) {
        const delay = delays[attempt];

        console.log(
          `[${label}] HTTP ${response.status}. Retrying in ${delay / 1000}s...`
        );

        await response.text();
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      // Do not repeat a full 180-second timeout automatically.
      if (
        error.name === "TimeoutError" ||
        error.name === "AbortError"
      ) {
        throw error;
      }

      if (attempt >= 2) {
        throw error;
      }

      const delay = delays[attempt];

      console.log(
        `[${label}] Network error: ${error.message}. Retrying in ${delay / 1000}s...`
      );

      await sleep(delay);
    }
  }

  throw new Error("All retry attempts failed.");
}

// HEALTH CHECK
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.AI_API_KEY),
    model: getModel()
  });
});

// GEMINI CONNECTION TEST
app.get("/api/test-gemini", async (_req, res) => {
  if (!process.env.AI_API_KEY) {
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
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
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

    console.log("[TEST] Gemini HTTP:", response.status);
    console.log("[TEST] Response:", body.slice(0, 1200));

    return res.json({
      ok: response.ok,
      status: response.status,
      response: body.slice(0, 1200)
    });
  } catch (error) {
    console.error("[TEST] Failed:", error.name, error.message);

    return res.json({
      ok: false,
      error: error.message
    });
  }
});

// STRUCTURED JSON TEST
app.get("/api/test-json", async (_req, res) => {
  if (!process.env.AI_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: "Missing API key"
    });
  }

  console.log("[TEST JSON] Starting JSON test");

  try {
    const response = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: getModel(),
        reasoning_effort: "low",
        temperature: 0.1,
        max_tokens: 1200,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: `Return ONLY JSON with this exact structure:
{
  "assistant": "Test successful",
  "files": {
    "index.html": "<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>",
    "style.css": "body { margin: 0; }",
    "script.js": "console.log('Hello');"
  }
}`
          },
          {
            role: "user",
            content: "Generate the required JSON."
          }
        ]
      }),
      signal: AbortSignal.timeout(90000)
    });

    const raw = await response.text();

    console.log("[TEST JSON] HTTP:", response.status);
    console.log("[TEST JSON] Response:", raw.slice(0, 1800));

    if (!response.ok) {
      return res.json({
        ok: false,
        status: response.status,
        error: raw.slice(0, 1500)
      });
    }

    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    const result = extractJson(content);

    const validFiles =
      typeof result.files?.["index.html"] === "string" &&
      typeof result.files?.["style.css"] === "string" &&
      typeof result.files?.["script.js"] === "string";

    return res.json({
      ok: validFiles,
      status: response.status,
      validFiles,
      assistant: result.assistant || null,
      fileLengths: validFiles
        ? {
            html: result.files["index.html"].length,
            css: result.files["style.css"].length,
            js: result.files["script.js"].length
          }
        : null
    });
  } catch (error) {
    console.error("[TEST JSON] Failed:", error.name, error.message);

    return res.json({
      ok: false,
      error: error.message
    });
  }
});

// MAIN WEBSITE GENERATION
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

  const safeMessages = messages.slice(-6).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 8000)
  }));

  const projectContext = Object.keys(files).length
    ? "\n\nCURRENT PROJECT FILES:\n" +
      JSON.stringify(files).slice(0, 18000)
    : "\n\nNo existing project. Create a complete website.";

  const requestBody = {
    model: getModel(),
    reasoning_effort: "low",
    temperature: 0.2,
    max_tokens: 12000,
    response_format: {
      type: "json_object"
    },
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

    console.log(
      "[AI] Request size:",
      Buffer.byteLength(JSON.stringify(requestBody)),
      "bytes"
    );

    const upstream = await fetchWithRetry(
      `${getBaseUrl()}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(180000)
      },
      "AI"
    );

    const rawBody = await upstream.text();

    let data;

    try {
      data = JSON.parse(rawBody);
    } catch {
      console.error("[AI] Invalid provider response:", rawBody.slice(0, 1200));

      return res.status(502).json({
        error: "Gemini returned an unreadable response."
      });
    }

    if (!upstream.ok) {
      const message =
        data?.error?.message ||
        rawBody.slice(0, 1200) ||
        `HTTP ${upstream.status}`;

      console.error("[AI] Provider error:", message);

      return res.status(upstream.status === 503 ? 503 : 502).json({
        error: `Gemini returned HTTP ${upstream.status}: ${message}`
      });
    }

    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      console.error("[AI] Empty response:", JSON.stringify(data).slice(0, 1200));

      return res.status(502).json({
        error: "Gemini returned an empty response."
      });
    }

    let result;

    try {
      result = extractJson(content);
    } catch {
      console.error("[AI] Invalid generated JSON:", content.slice(0, 1600));

      return res.status(502).json({
        error: "Gemini did not return valid website JSON."
      });
    }

    if (
      !result.files ||
      typeof result.files["index.html"] !== "string" ||
      typeof result.files["style.css"] !== "string" ||
      typeof result.files["script.js"] !== "string"
    ) {
      console.error("[AI] Required website files are missing");

      return res.status(502).json({
        error: "Gemini did not return all three required files."
      });
    }

    console.log(`[AI] SUCCESS - Generated in ${Date.now() - startedAt}ms`);

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
        error: "Gemini took too long to respond. Try again in a moment."
      });
    }

    return res.status(502).json({
      error: "Could not reach Gemini. Check the Render logs."
    });
  }
});

// FRONTEND
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`VELQOZA AI running on port ${port}`);
});
