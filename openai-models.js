/** Server-only OpenAI model routing and conservative spend safeguards. */
export const OPENAI_MODELS = Object.freeze({
  'gpt-6.2-sol': { label: 'GPT-6.2 Sol', description: 'Fast, versatile building and edits', maxOutputTokens: 10000 },
  'gpt-6.2-astra': { label: 'GPT-6.2 Astra', description: 'Advanced coding, 3D and complex projects', maxOutputTokens: 16000 }
});

export const isOpenAIModel = id => Object.hasOwn(OPENAI_MODELS, id);

export const openAIEnabled = (env = process.env) =>
  env.OPENAI_MODELS_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY);

export function modelChoices(baseProvider, env = process.env) {
  const base = baseProvider === 'ollama'
    ? { id: 'ollama', label: 'Local Ollama', description: 'Local AI model', available: true }
    : { id: 'gemini', label: 'Gemini', description: 'Default website builder', available: Boolean(env.AI_API_KEY) };
  return [
    base,
    ...Object.entries(OPENAI_MODELS).map(([id, details]) => ({
      id, label: details.label, description: details.description, available: openAIEnabled(env)
    }))
  ];
}

export function selectModel(requested, baseProvider, env = process.env) {
  const fallback = baseProvider === 'ollama' ? 'ollama' : 'gemini';
  if (requested === undefined || requested === null || requested === '') return fallback;
  if (typeof requested !== 'string') return null;
  if (requested === fallback) return fallback;
  if (isOpenAIModel(requested)) return openAIEnabled(env) ? requested : 'unavailable';
  return null;
}

const WEBSITE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'velqoza_website',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        assistant: { type: 'string' },
        files: {
          type: 'object',
          properties: {
            'index.html': { type: 'string' },
            'style.css': { type: 'string' },
            'script.js': { type: 'string' }
          },
          required: ['index.html', 'style.css', 'script.js'],
          additionalProperties: false
        }
      },
      required: ['assistant', 'files'],
      additionalProperties: false
    }
  }
};

/** Sends a request through the backend only. Never ship OPENAI_API_KEY to the browser. */
export async function requestOpenAI(messages, model, { env = process.env, fetchImpl = fetch } = {}) {
  if (!isOpenAIModel(model) || !openAIEnabled(env)) {
    throw new Error('Selected OpenAI model is not enabled.');
  }
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: WEBSITE_FORMAT,
      max_completion_tokens: OPENAI_MODELS[model].maxOutputTokens
    }),
    signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('The OpenAI API key is invalid.');
    if (response.status === 403) throw new Error('OpenAI has not enabled access to this model.');
    if (response.status === 429) throw new Error('OpenAI rate limit or billing quota reached.');
    throw new Error(`OpenAI request failed (HTTP ${response.status}).`);
  }
  const data = await response.json();
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('OpenAI output reached its token limit. Try a smaller request.');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI did not return usable website JSON.');
  }
  return content;
}

function clampLimit(value, fallback) {
  const num = Number(value);
  return Number.isSafeInteger(num) && num >= 1 ? Math.min(num, 500) : fallback;
}

/** Best-effort in-memory limits; use persistent authenticated quotas before public paid launch. */
export function makeOpenAIQuota(env = process.env) {
  const globalDailyLimit = clampLimit(env.OPENAI_DAILY_LIMIT, 20);
  const perIpDailyLimit = clampLimit(env.OPENAI_PER_IP_DAILY_LIMIT, 5);
  let day = '';
  let total = 0;
  const byIp = new Map();
  return (ip, now = new Date()) => {
    const currentDay = now.toISOString().slice(0, 10);
    if (currentDay !== day) { day = currentDay; total = 0; byIp.clear(); }
    const key = String(ip || 'unknown');
    const used = byIp.get(key) || 0;
    if (total >= globalDailyLimit || used >= perIpDailyLimit) return false;
    total++;
    byIp.set(key, used + 1);
    return true;
  };
}
