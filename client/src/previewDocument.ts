/**
 * Browser-only preview assembly. The editor's iframe is sandboxed and has no
 * filesystem, so project-local linked CSS/JS assets must be embedded in srcDoc.
 * Keep ZIP exports as separate linked files and preserve script execution order.
 */
type PreviewSite = {
  title: string
  description: string
  html: string
  css: string
  js: string
  pages?: Record<string, string>
  files?: Record<string, string>
}

function attribute(tag: string, name: string): string | null {
  const rx = new RegExp(`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, 'i')
  const match = tag.match(rx)
  return match ? (match[1] ?? match[2] ?? match[3]) : null
}

function relativeAsset(value: string | null): string | null {
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(value)) return null
  const path = value.split(/[?#]/, 1)[0].replace(/^(?:\.\/)+/, '')
  if (!/^[a-z0-9._\/-]+$/i.test(path) || path.split('/').includes('..')) return null
  return path
}

function htmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c)
}

function inlineCSS(text: string, name: string): string {
  return `<style data-project-file="${htmlEscape(name)}">${text.replace(/<\/style/gi, '<\\/style')}</style>`
}

function inlineJS(text: string, name: string): string {
  return `<script data-project-file="${htmlEscape(name)}">${text.replace(/<\/script/gi, '<\\/script')}</script>`
}

export function buildPreviewDocument(site: PreviewSite, filename = 'index.html', exported = false): string {
  const pages = site.pages && Object.keys(site.pages).length ? site.pages : { 'index.html': site.html }
  const raw = pages[filename] || pages['index.html'] || site.html
  const extras = site.files || {}
  const styles: string[] = []
  const scripts: string[] = []
  const seenStyles = new Set<string>()
  const seenScripts = new Set<string>()

  // Strip only references that the editor can resolve. Leave remote assets
  // (and unknown files) unchanged. Collect scripts to execute AFTER main js.
  let clean = raw.replace(/<link\b[^>]*>/gi, tag => {
    if (!/\bstylesheet\b/i.test(attribute(tag, 'rel') || '')) return tag
    const name = relativeAsset(attribute(tag, 'href'))
    if (!name) return tag
    if (name === 'styles.css') return ''
    if (!Object.prototype.hasOwnProperty.call(extras, name) || !/\.css$/i.test(name)) return tag
    if (!seenStyles.has(name)) { styles.push(name); seenStyles.add(name) }
    return ''
  })
  clean = clean.replace(/<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*<\/script\s*>/gi, tag => {
    const name = relativeAsset(attribute(tag, 'src'))
    if (!name) return tag
    if (name === 'script.js') return ''
    if (!Object.prototype.hasOwnProperty.call(extras, name) || !/\.js$/i.test(name)) return tag
    if (!seenScripts.has(name)) { scripts.push(name); seenScripts.add(name) }
    return ''
  })

  const cssTags = exported
    ? ['<link rel="stylesheet" href="styles.css">', ...styles.map(name => `<link rel="stylesheet" href="${htmlEscape(name)}">`)].join('')
    : [inlineCSS(site.css, 'styles.css'), ...styles.map(name => inlineCSS(extras[name], name))].join('')
  const jsTags = exported
    ? ['<script src="script.js"></script>', ...scripts.map(name => `<script src="${htmlEscape(name)}"></script>`)].join('')
    : [inlineJS(site.js, 'script.js'), ...scripts.map(name => inlineJS(extras[name], name))].join('')
  const navigator = exported ? '' : `<script>document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h)return;var m=h.match(/^\\.?\\/?([a-z0-9_-]+\\.html)(#[^?]*)?$/i);if(m){e.preventDefault();parent.postMessage({type:'velqoza-navigate',filename:m[1].toLowerCase(),hash:m[2]||''},'*')}});</script>`

  if (/<!doctype\s+html|<html[\s>]/i.test(clean)) {
    const hebrew = /[\u0590-\u05FF]/.test(clean)
    const arabic = /[\u0600-\u06FF]/.test(clean)
    const language = hebrew ? 'he' : arabic ? 'ar' : 'en'
    if (!/<html[^>]*\blang=/i.test(clean)) clean = clean.replace(/<html([\s>])/i, `<html lang="${language}"$1`)
    if ((arabic || hebrew) && !/<html[^>]*\bdir=/i.test(clean)) clean = clean.replace(/<html([\s>])/i, '<html dir="rtl"$1')
    if (/<\/head>/i.test(clean)) clean = clean.replace(/<\/head>/i, cssTags + '</head>')
    else if (/<body([^>]*)>/i.test(clean)) clean = clean.replace(/<body([^>]*)>/i, `<head>${cssTags}</head><body$1>`)
    else clean = cssTags + clean
    if (/<\/body>/i.test(clean)) return clean.replace(/<\/body>/i, jsTags + navigator + '</body>')
    if (/<\/html>/i.test(clean)) return clean.replace(/<\/html>/i, jsTags + navigator + '</html>')
    return clean + jsTags + navigator
  }
  const hebrew = /[\u0590-\u05FF]/.test(clean)
  const arabic = /[\u0600-\u06FF]/.test(clean)
  const lang = hebrew ? 'he' : arabic ? 'ar' : 'en'
  const rtl = arabic || hebrew ? ' dir="rtl"' : ''
  return `<!doctype html><html lang="${lang}"${rtl}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${htmlEscape(site.description)}"><title>${htmlEscape(site.title)} — ${htmlEscape(filename)}</title>${cssTags}</head><body>${clean}${jsTags}${navigator}</body></html>`
}
