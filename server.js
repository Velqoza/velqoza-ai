
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
- Create polished, responsive, accessible websites with real content.
- Use vanilla HTML, CSS and JavaScript only.
- Keep CSS in style.css and JavaScript in script.js.
- When editing, preserve the existing project and modify it.
- Never pretend backend, payment, login or database features work unless implemented.
- Never include API keys or secrets in generated files.
- Return valid JSON only.`;

const provider = () =>
  (process.env.AI_PROVIDER || "gemini").toLowerCase();

const getBaseUrl = () =>
  (process.env.AI_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai"
  ).replace(/\/+$/, "");

const getGeminiModel = () =>
  process.env.AI_MODEL || "gemini-3.8-flash";

const getOllamaUrl = () =>
  (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434")
    .replace(/\/+$/, "");

const getOllamaModel = () =>
  process.env.OLLAMA_MODEL || "qwen3.5:4b";

const getCurrentModel = () =>
  provider() === "ollama"
    ? getOllamaModel()
    : getGeminiModel();

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

function validWebsiteFiles(result) {
  return (
    result &&
    result.files &&
    typeof result.files["index.html"] === "string" &&
    typeof result.files["style.css"] === "string" &&
    typeof result.files["script.js"] === "string"
  );
}

function isRetryable(status) {
  return status === 429 || status === 503 || status >= 500;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestGemini(messages, options = {}) {
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    throw new Error("AI API key is not configured.");
  }

  const requestBody = {
    model: getGeminiModel(),
    reasoning_effort: "low",
    temperature: 0.2,
    max_tokens: options.maxTokens || 12000,
    response_format: {
      type: "json_object"
    },
    messages
  };

  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `${getBaseUrl()}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(
            options.timeout || 180000
          )
        }
      );

      const raw = await response.text();

      if (!response.ok) {
        const error = new Error(
          `Gemini HTTP ${response.status}: ${raw.slice(0, 600)}`
        );
        error.status = response.status;
        throw error;
      }

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("Gemini returned invalid JSON.");
      }

      const content = data?.choices?.[0]?.message?.content;

      if (typeof content !== "string" || !content.trim()) {
        throw new Error("Gemini returned an empty response.");
      }

      return content;
    } catch (error) {
      lastError = error;

      const retryable =
        error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        error.name === "TypeError" ||
        (error.status && isRetryable(error.status));

      if (!retryable || attempt === 2) {
        break;
      }

      console.log(
        `[GEMINI] Retry ${attempt + 1}:`,
        error.message
      );

      await sleep(2000 * (attempt + 1));
    }
  }

  throw lastError;
}

async function requestOllama(messages, options = {}) {
  const response = await fetch(
    `${getOllamaUrl()}/api/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: getOllamaModel(),
        messages,
        stream: false,
        think: false,
        format: "json",
        options: {
          temperature: 0.2,
          num_predict: options.maxTokens || 12000,
          num_ctx: 8192
        },
        keep_alive: "10m"
      }),
      signal: AbortSignal.timeout(
        options.timeout || 600000
      )
    }
  );

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `Ollama HTTP ${response.status}: ${raw.slice(0, 600)}`
    );
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Ollama returned invalid API JSON.");
  }

  const content = data?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Ollama returned an empty response.");
  }

  return content;
}

async function requestAI(messages, options = {}) {
  if (provider() === "ollama") {
    return requestOllama(messages, options);
  }

  return requestGemini(messages, options);
}

// HEALTH CHECK
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: provider(),
    configured:
      provider() === "ollama" ||
      Boolean(process.env.AI_API_KEY),
    model: getCurrentModel()
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

  try {
    const content = await requestGemini(
      [
        {
          role: "user",
          content: "Reply with only the word OK."
        }
      ],
      {
        maxTokens: 20,
        timeout: 45000
      }
    );

    return res.json({
      ok: true,
      response: content
    });
  } catch (error) {
    console.error("[TEST GEMINI]", error.message);

    return res.json({
      ok: false,
      error: error.message
    });
  }
});

// OLLAMA CONNECTION TEST
app.get("/api/test-ollama", async (_req, res) => {
  try {
    const response = await fetch(
      `${getOllamaUrl()}/api/tags`,
      {
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const data = await response.json();

    const models = (data.models || []).map(
      model => model.name
    );

    return res.json({
      ok: true,
      model: getOllamaModel(),
      installed: models.includes(getOllamaModel()),
      models
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: "Could not reach local Ollama: " + error.message
    });
  }
});

// STRUCTURED JSON TEST
app.get("/api/test-json", async (_req, res) => {
  try {
    const content = await requestAI(
      [
        {
          role: "system",
          content: `Return ONLY JSON:
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
      ],
      {
        maxTokens: 1200,
        timeout: provider() === "ollama" ? 180000 : 90000
      }
    );

    const result = extractJson(content);
    const validFiles = validWebsiteFiles(result);

    return res.json({
      ok: Boolean(validFiles),
      validFiles: Boolean(validFiles),
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
    console.error("[TEST JSON]", error.message);

    return res.json({
      ok: false,
      error: error.message
    });
  }
});

// MAIN WEBSITE GENERATION
app.post("/api/chat", async (req, res) => {
  const startedAt = Date.now();

  console.log(
    "[AI] New request:",
    provider(),
    getCurrentModel()
  );

  if (
    provider() !== "ollama" &&
    !process.env.AI_API_KEY
  ) {
    return res.status(503).json({
      error: "AI API key is not configured."
    });
  }

  if (!["ollama", "gemini"].includes(provider())) {
    return res.status(503).json({
      error: "Unsupported AI_PROVIDER."
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

  const safeFiles =
    files && typeof files === "object" && !Array.isArray(files)
      ? files
      : {};

  const projectContext = Object.keys(safeFiles).length
    ? "\n\nCURRENT PROJECT FILES:\n" +
      JSON.stringify(safeFiles).slice(0, 18000)
    : "\n\nNo existing project. Create a complete website.";

  const messagesForAI = [
    {
      role: "system",
      content: SYSTEM_PROMPT + projectContext
    },
    ...safeMessages
  ];

  try {
    const content = await requestAI(messagesForAI);

    let result;

    try {
      result = extractJson(content);
    } catch {
      console.error(
        "[AI] Invalid generated JSON:",
        content.slice(0, 1000)
      );

      return res.status(502).json({
        error: "AI did not return valid website JSON."
      });
    }

    if (!validWebsiteFiles(result)) {
      return res.status(502).json({
        error: "AI did not return all three required files."
      });
    }

    console.log(
      `[AI] SUCCESS in ${Date.now() - startedAt}ms`
    );

    return res.json({
      assistant: String(
        result.assistant || "Your website is ready."
      ),
      files: {
        "index.html": result.files["index.html"],
        "style.css": result.files["style.css"],
        "script.js": result.files["script.js"]
      }
    });
  } catch (error) {
    console.error(
      "[AI] Request failed:",
      error.name,
      error.message
    );

    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      return res.status(504).json({
        error: "AI took too long to respond."
      });
    }

    return res.status(502).json({
      error: "AI request failed: " + error.message
    });
  }
});

// FRONTEND
app.get("*", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`VELQOZA AI running on port ${port}`);
  console.log(`AI Provider: ${provider()}`);
  console.log(`AI Model: ${getCurrentModel()}`);
});
