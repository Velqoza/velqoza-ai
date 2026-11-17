import test from 'node:test';
import assert from 'node:assert/strict';
import { modelChoices, selectModel, requestOpenAI, makeOpenAIQuota } from '../openai-models.js';

const env = { AI_API_KEY: 'gemini-test', OPENAI_API_KEY: 'openai-test', OPENAI_MODELS_ENABLED: 'true' };

test('model selection is restricted to a server-side allowlist', () => {
  assert.equal(selectModel('gpt-6.2-sol', 'gemini', env), 'gpt-6.2-sol');
  assert.equal(selectModel('gpt-6.2-astra', 'gemini', env), 'gpt-6.2-astra');
  assert.equal(selectModel('unknown-model', 'gemini', env), null);
  assert.equal(selectModel('gpt-6.2-astra', 'gemini', { ...env, OPENAI_MODELS_ENABLED: 'false' }), 'unavailable');
  assert.equal(selectModel(undefined, 'gemini', env), 'gemini');
  assert.equal(selectModel(undefined, 'ollama', env), 'ollama');
  assert.equal(modelChoices('gemini', env).length, 3);
});

test('OpenAI request uses an approved model, server key and structured output', async () => {
  let request;
  const response = await requestOpenAI([{ role: 'user', content: 'Build a site' }], 'gpt-6.2-sol', {
    env,
    fetchImpl: async (url, init) => {
      request = { url, ...init };
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"assistant":"Ready","files":{"index.html":"a","style.css":"b","script.js":"c"}}' } }] }) };
    }
  });
  assert.ok(response.includes('Ready'));
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer openai-test');
  const body = JSON.parse(request.body);
  assert.equal(body.model, 'gpt-6.2-sol');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.max_completion_tokens, 10000);
  assert.equal(body.temperature, undefined);
});

test('quota rejects excessive requests and resets on the next day', () => {
  const accept = makeOpenAIQuota({ OPENAI_DAILY_LIMIT: '2', OPENAI_PER_IP_DAILY_LIMIT: '1' });
  assert.equal(accept('1.1.1.1', new Date('2026-11-18T10:00:00Z')), true);
  assert.equal(accept('1.1.1.1', new Date('2026-11-18T10:00:00Z')), false);
  assert.equal(accept('2.2.2.2', new Date('2026-11-18T10:00:00Z')), true);
  assert.equal(accept('3.3.3.3', new Date('2026-11-18T10:00:00Z')), false);
  assert.equal(accept('1.1.1.1', new Date('2026-11-19T10:00:00Z')), true);
});
