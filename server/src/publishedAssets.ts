import type { SiteCode } from './types.js'

type ExtraAsset = { mime: 'text/css' | 'application/javascript'; content: string }
const own = (object: Record<string, string> | undefined, name: string): boolean =>
  !!object && Object.prototype.hasOwnProperty.call(object, name)

function pagesOf(code: SiteCode): Record<string, string> {
  return code.pages && Object.keys(code.pages).length ? code.pages : { 'index.html': code.html }
}

function attribute(tag: string, name: string): string | null {
  for (const match of tag.matchAll(/([a-z][a-z\d:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (match[1].toLowerCase() === name) return match[2] ?? match[3] ?? match[4]
  }
  return null
}

function localPath(value: string | null): string | null {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(value)) return null
  const path = value.split(/[?#]/, 1)[0].replace(/^(?:\.\/)+/, '')
  if (!/^[a-z\d][a-z\d_.\/-]*$/i.test(path) || path.split('/').some(part => part === '..' || !part)) return null
  return path
}

function linkedAssets(page: string, code: SiteCode, removeKnown: boolean) {
  const styles: string[] = []
  const scripts: string[] = []
  const addUnique = (list: string[], name: string) => { if (!list.includes(name)) list.push(name) }
  const resultAfterLinks = page.replace(/<link\b[^>]*>/gi, tag => {
    if (!(attribute(tag, 'rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) return tag
    const name = localPath(attribute(tag, 'href'))
    if (!name) return tag
    if (name === 'styles.css' || name === 'style.css') return removeKnown ? '' : tag
    if (name.endsWith('.css') && own(code.files, name)) {
      addUnique(styles, name)
      return removeKnown ? '' : tag
    }
    return tag
  })
  const cleaned = resultAfterLinks.replace(/<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*<\/script\s*>/gi, tag => {
    const name = localPath(attribute(tag, 'src'))
    if (!name) return tag
    if (name === 'script.js' || name === 'main.js') return removeKnown ? '' : tag
    if (name.endsWith('.js') && own(code.files, name)) {
      addUnique(scripts, name)
      return removeKnown ? '' : tag
    }
    return tag
  })
  return { html: cleaned, styles, scripts }
}

/** Only linked browser CSS/JS assets are public. Backend and config source stays private. */
export function publishedAsset(code: SiteCode, filename: string): ExtraAsset | null {
  if (!/^[a-z\d][a-z\d_.-]{0,80}$/i.test(filename) || !/\.(css|js)$/i.test(filename) || !own(code.files, filename)) return null
  const linked = Object.values(pagesOf(code)).some(page => {
    const { styles, scripts } = linkedAssets(page, code, false)
    return styles.includes(filename) || scripts.includes(filename)
  })
  if (!linked) return null
  return { mime: filename.endsWith('.css') ? 'text/css' : 'application/javascript', content: code.files![filename] }
}

const cleanTitle = (value: string) => value.replace(/[<>&]/g, '')

/**
 * Build public pages with base CSS first and base JS BEFORE dependent scripts.
 * Public assets are URL-based and served with correct MIME types and sandbox CSP.
 */
export function buildPublishedDocument(code: SiteCode, filename: string): string {
  const pages = pagesOf(code)
  const source = pages[filename]
  const { html, styles, scripts } = linkedAssets(source, code, true)
  const cssLinks = ['styles.css', ...styles].map(name => '<link rel="stylesheet" href="' + name + '">').join('')
  const scriptTags = ['script.js', ...scripts].map(name => '<script src="' + name + '"></script>').join('')
  const full = /<!doctype\s+html|<html[\s>]/i.test(html)
  const he = /[\u0590-\u05FF]/.test(html) || /[\u0590-\u05FF]/.test(code.title)
  const ar = /[\u0600-\u06FF]/.test(html) || /[\u0600-\u06FF]/.test(code.title)
  const lang = he ? 'he' : ar ? 'ar' : 'en'
  const dir = he || ar ? 'rtl' : 'ltr'
  let document = full ? html :
    '<!doctype html><html lang="' + lang + '" dir="' + dir + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + cleanTitle(code.title) + '</title></head><body>' + html + '</body></html>'
  if (full && !/<html[^>]*\blang=/i.test(document))
    document = document.replace(/<html([\s>])/i, '<html lang="' + lang + '"$1')
  if (full && !/<html[^>]*\bdir=/i.test(document))
    document = document.replace(/<html([\s>])/i, '<html dir="' + dir + '"$1')
  document = /<\/head>/i.test(document) ? document.replace(/<\/head>/i, cssLinks + '</head>') : cssLinks + document
  document = /<\/body>/i.test(document) ? document.replace(/<\/body>/i, scriptTags + '</body>') : document + scriptTags
  return document
}
