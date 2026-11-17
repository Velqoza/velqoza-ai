import test from 'node:test'
import assert from 'node:assert/strict'
import { PREVIEW_RUNTIME_CSP, PREVIEW_RUNTIME_HTML } from '../src/previewRuntime.js'

test('preview response permits inline generated JS only inside an isolated opaque-origin sandbox',()=>{
  assert.match(PREVIEW_RUNTIME_CSP, /sandbox allow-scripts/)
  assert.doesNotMatch(PREVIEW_RUNTIME_CSP, /allow-same-origin/)
  assert.match(PREVIEW_RUNTIME_CSP, /script-src[^;]*'unsafe-inline'/)
  assert.match(PREVIEW_RUNTIME_CSP, /frame-ancestors 'self'/)
  assert.match(PREVIEW_RUNTIME_CSP, /base-uri 'none'/)
  assert.match(PREVIEW_RUNTIME_CSP, /object-src 'none'/)
})

test('preview runtime exchanges HTML only with the embedding parent window',()=>{
  assert.match(PREVIEW_RUNTIME_HTML, /event.source !== window.parent/)
  assert.match(PREVIEW_RUNTIME_HTML, /velqoza-preview-ready/)
  assert.match(PREVIEW_RUNTIME_HTML, /velqoza-preview-document/)
  assert.match(PREVIEW_RUNTIME_HTML, /3000000/)
  assert.match(PREVIEW_RUNTIME_HTML, /document.write\(event.data.html\)/)
  assert.doesNotMatch(PREVIEW_RUNTIME_HTML, /localStorage|sessionStorage|cookie/)
})
