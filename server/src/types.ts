import type { Request } from 'express'
export type SiteCode = { title: string; description: string; html: string; css: string; js: string; pages?: Record<string, string>; files?: Record<string, string> }
export type AuthRequest = Request & { userId?: string }
