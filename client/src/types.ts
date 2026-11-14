export type SiteCode = { title: string; description: string; html: string; css: string; js: string; pages?: Record<string, string>; files?: Record<string, string> }
export type Project = { id: string; name: string; code: SiteCode; createdAt: string; updatedAt: string }
export type User = { id: string; email: string; displayName?:string; emailVerified?:boolean; createdAt?:string; isAdmin?:boolean }

export type StudioPlugin = {id:string;name:string;description:string;icon:string;needsProject:boolean}
export type StudioThread = {id:string;title:string;createdAt:string;updatedAt:string}
export type StudioMessage = {id:string;role:'user'|'assistant';content:string;createdAt:string}
