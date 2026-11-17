/**
 * Dedicated generated-project preview response. The account application
 * retains strict script CSP; this sandboxed document alone permits inline JS.
 * srcDoc/blob previews inherit the parent's CSP and cannot execute game code.
 */
export const PREVIEW_RUNTIME_CSP = [
  'sandbox allow-scripts',
  "default-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'font-src * data:',
  'connect-src https:',
  'form-action https:',
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "object-src 'none'"
].join('; ')

export const PREVIEW_RUNTIME_HTML = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>VELQOZA preview</title></head><body>\n<script>\n(() => {\n  function receive(event) {\n    if (event.source !== window.parent ||\n        !event.data || event.data.type !== 'velqoza-preview-document' ||\n        typeof event.data.html !== 'string' ||\n        event.data.html.length > 3000000) return;\n    window.removeEventListener('message', receive);\n    document.open();\n    document.write(event.data.html);\n    document.close();\n  }\n  window.addEventListener('message', receive);\n  window.parent.postMessage({type:'velqoza-preview-ready'}, '*');\n})();\n</script>\n</body></html>"
