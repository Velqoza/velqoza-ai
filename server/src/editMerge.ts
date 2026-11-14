import type { SiteCode } from './types.js'
import { validateExtraFiles } from './projectFiles.js'

export type EditChanges = {
  title: string | null
  description: string | null
  pages: {filename:string;html:string}[]
  css: string | null
  js: string | null
  extraFiles: {path:string;content:string}[]
}

// Pure merge: a failed response never mutates the original project.
export function mergeEditChanges(original: SiteCode, change: EditChanges): SiteCode {
  const pages: Record<string,string> = {...(original.pages || {'index.html':original.html})}
  const files: Record<string,string> = {...(original.files || {})}
  const seenPages = new Set<string>()
  for (const page of change.pages) {
    const filename = page.filename.toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]*\.html$/i.test(filename) || filename.length > 80 || seenPages.has(filename)) {
      throw new Error('AI edit returned a duplicate or unsafe HTML page; your original project is unchanged.')
    }
    if (page.html.length > 180000) throw new Error('AI edit exceeded a page size limit; original project is unchanged.')
    seenPages.add(filename)
    pages[filename] = page.html
  }
  if (!Object.hasOwn(pages,'index.html') || Object.keys(pages).length > 12 || Object.values(pages).join('').length > 500000) {
    throw new Error('AI edit exceeded the page limit; your original project is unchanged.')
  }
  const seenFiles = new Set<string>()
  for (const file of change.extraFiles) {
    const normalized = file.path.toLowerCase()
    if (seenFiles.has(normalized) || Object.keys(files).some(key => key.toLowerCase() === normalized && key !== file.path)) {
      throw new Error('AI edit returned duplicate file names; your original project is unchanged.')
    }
    seenFiles.add(normalized)
    files[file.path] = file.content
  }
  const err = validateExtraFiles(files)
  if (err) throw new Error(`AI edit was rejected: ${err}`)
  const css = change.css ?? original.css
  const js = change.js ?? original.js
  if (css.length > 180000 || js.length > 80000) throw new Error('AI edit exceeded script or style size limits; original project is unchanged.')
  if (change.title !== null && (change.title.length < 1 || change.title.length > 160)) throw new Error('Invalid project title from AI edit.')
  if (change.description !== null && change.description.length > 2000) throw new Error('Invalid project description from AI edit.')
  return {
    title: change.title ?? original.title,
    description: change.description ?? original.description,
    html: pages['index.html'],
    css, js, pages, files
  }
}
