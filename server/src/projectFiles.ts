/** Shared server-side validation of generated text-only project files. Nothing here executes generated code. */
export const RESERVED_ROOT_FILES = new Set(['index.html', 'styles.css', 'script.js'])
const allowedExtensions = /\.(?:html|css|js|mjs|cjs|ts|tsx|jsx|json|md|txt|sql|yml|yaml|svg)$/i
const forbiddenNames = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'vendor', 'private', 'secrets', '__proto__', 'prototype', 'constructor'])

export function validExtraFilePath(input: string): boolean {
  if (!input || input.length > 160 || input.includes('\\') || input.startsWith('/') || input.includes('\0') || input.includes(':') || input.includes('%')) return false
  const parts = input.split('/')
  if (parts.length > 5 || parts.some(p => !p || p === '.' || p === '..' || !/^[a-zA-Z0-9_.-]+$/.test(p) || forbiddenNames.has(p.toLowerCase()))) return false
  const basename = parts[parts.length - 1].toLowerCase()
  if (parts.length === 1 && RESERVED_ROOT_FILES.has(basename)) return false
  if (parts.some(p => p.startsWith('.') && !['.env.example', '.gitignore'].includes(p.toLowerCase()))) return false
  if (basename === '.env.example' || basename === '.gitignore') return parts.length === 1 || (parts.length === 2 && parts[0].toLowerCase() === 'server')
  if (basename.includes('.env') || basename.endsWith('.key') || basename.endsWith('.pem') || basename.endsWith('.cert') || basename === 'id_rsa') return false
  return allowedExtensions.test(basename)
}

export function validateExtraFiles(files: Record<string,string> | undefined): string | null {
  if (!files) return null
  const names = Object.keys(files)
  if (names.length > 30) return 'Too many additional project files (maximum 30).'
  const seen = new Set<string>()
  let total = 0
  for (const name of names) {
    if (!validExtraFilePath(name)) return `Unsupported or unsafe file path: ${name}`
    if (seen.has(name.toLowerCase())) return 'Duplicate project filenames are not allowed.'
    seen.add(name.toLowerCase())
    const content = files[name]
    if (typeof content !== 'string' || content.length > 180000) return 'A project file exceeds its size limit.'
    total += content.length
  }
  if (total > 900000) return 'Additional project files exceed the combined size limit.'
  return null
}
