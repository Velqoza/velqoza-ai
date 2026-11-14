import type { SiteCode } from './types.js'

export const studioPluginCatalog = [
  { id: 'seo-audit', name: 'SEO Auditor', description: 'Inspect headings, links, metadata and page structure of your current project.', icon: 'search', needsProject: true },
  { id: 'accessibility', name: 'Accessibility Check', description: 'Find common accessibility issues in generated markup.', icon: 'shield', needsProject: true },
  { id: 'project-map', name: 'Project Explorer', description: 'Summarize actual pages and source files available in the open project.', icon: 'files', needsProject: true },
  { id: 'launch-checklist', name: 'Launch Checklist', description: 'Provide a practical, project-aware checklist before deployment.', icon: 'rocket', needsProject: false }
] as const
export type StudioPluginId = typeof studioPluginCatalog[number]['id']
export function runStudioPlugins(ids: StudioPluginId[], code?: SiteCode) {
  const results: { plugin: string; report: string }[] = []
  const pages = code ? (code.pages && Object.keys(code.pages).length ? code.pages : { 'index.html': code.html }) : {}
  for (const id of ids) {
    if (id === 'project-map') {
      results.push({plugin:id, report: code ? `Project: ${code.title}\nPages: ${Object.keys(pages).join(', ')}\nExtra source files: ${Object.keys(code.files || {}).join(', ') || 'none'}\nCSS characters: ${code.css.length}; JS characters: ${code.js.length}` : 'No project attached; ask the user to open a project.'})
    } else if (id === 'seo-audit') {
      if (!code) { results.push({plugin:id,report:'No project attached.'}); continue }
      const notes: string[] = []
      for (const [name, html] of Object.entries(pages)) {
        const h1 = (html.match(/<h1\b/gi)||[]).length
        const imgs = (html.match(/<img\b[^>]*>/gi)||[])
        const missingAlt = imgs.filter(x=> !/\balt\s*=/i.test(x)).length
        const links = (html.match(/<a\b/gi)||[]).length
        notes.push(`${name}: H1 count=${h1}; images missing alt=${missingAlt}; links=${links}`)
      }
      results.push({plugin:id,report: notes.join('\n')+'\nNote: generated page wrapper supplies a basic meta description; validate real output and search indexing separately.'})
    } else if (id === 'accessibility') {
      if (!code) {results.push({plugin:id,report:'No project attached.'}); continue}
      const notes: string[] = []
      for (const [name, html] of Object.entries(pages)) {
        const unlabelled = (html.match(/<button\b[^>]*>\s*<(?:svg|i)\b/gi)||[]).length
        const images = (html.match(/<img\b[^>]*>/gi)||[])
        const unlabeledImages = images.filter(x=> !/\balt\s*=/i.test(x)).length
        notes.push(`${name}: image alt omissions=${unlabeledImages}; icon-only buttons needing manual review=${unlabelled}`)
      }
      results.push({plugin:id,report:notes.join('\n')+'\nStatic heuristic only: keyboard use, contrast, focus behavior and screen readers still require testing.'})
    } else if (id === 'launch-checklist') {
      results.push({plugin:id,report:`Review responsive layouts; check all links and forms; audit accessibility; remove test data; ensure secure server authentication for admin features; configure HTTPS and environment secrets; check performance; verify legal/privacy notices. ${code ? 'Project has '+Object.keys(pages).length+' frontend page(s).' : 'No current project attached.'} Generated backend code is not executed within the frontend preview.`})
    }
  }
  return results
}
