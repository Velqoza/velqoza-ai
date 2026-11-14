import type { Project, SiteCode, User, StudioPlugin, StudioThread, StudioMessage } from './types'
const TOKEN_KEY = 'velqoza_token'
const ACCOUNTS_KEY = 'velqoza_accounts_v1'
export type SavedAccount = {id:string;email:string;displayName?:string;token:string}
const readAccounts = ():SavedAccount[] => {
  try {
    const raw=JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((a:unknown):a is SavedAccount => !!a && typeof a==='object' && typeof (a as SavedAccount).id==='string' && typeof (a as SavedAccount).email==='string' && typeof (a as SavedAccount).token==='string').slice(0,5):[]
  } catch{return []}
}
const saveAccounts=(items:SavedAccount[])=>localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(items.slice(0,5)))

const token = () => localStorage.getItem(TOKEN_KEY)
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...options.headers }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status}). Check that the API server is running.`) as Error & {status?: number}
    error.status = response.status
    throw error
  }
  return body as T
}
export const api = {
  token,
  savedAccounts:readAccounts,
  rememberAccount:(user:User,secret:string)=>{
    const others=readAccounts().filter(a=>a.id!==user.id)
    saveAccounts([{id:user.id,email:user.email,displayName:user.displayName,token:secret},...others].slice(0,5))
  },
  removeSavedAccount:(id:string)=>saveAccounts(readAccounts().filter(a=>a.id!==id)),
  clearSavedAccounts:()=>localStorage.removeItem(ACCOUNTS_KEY),
  validateAccountToken:async(savedToken:string):Promise<User>=>{
    const response=await fetch('/api/auth/me',{headers:{Authorization:`Bearer ${savedToken}`},cache:'no-store'})
    const body=await response.json().catch(()=>({}))
    if(!response.ok) throw Object.assign(new Error(body.error || 'Saved session is no longer valid.'),{status:response.status})
    return body.user as User
  },
  updateProfile:(displayName:string)=>request<{user:User}>('/account/profile',{method:'PATCH',body:JSON.stringify({displayName})}),
  changePassword:(currentPassword:string,newPassword:string)=>request<{ok:true;token:string}>('/account/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})}),
  signOutOtherDevices:()=>request<{ok:true;token:string}>('/account/sign-out-other-devices',{method:'POST',body:JSON.stringify({})}),
  adminOverview: () => request<{users:{id:string;email:string;createdAt:string;isBanned:number;credits:number;projects:number;conversations:number}[];totals:{accounts:number;projects:number;banned:number;outstandingCredits:number}}>('/admin/overview'),
  adminAudit: () => request<{entries:{action:string;detail:string;targetUserId:string|null;createdAt:string}[]}>('/admin/audit'),
  adminCredits: (id:string,delta:number,reason:string) => request<{ok:true;balance:number}>(`/admin/users/${id}/credits`,{method:'POST',body:JSON.stringify({delta,reason})}),
  adminBan: (id:string,banned:boolean) => request<{ok:true}>(`/admin/users/${id}/ban`,{method:'POST',body:JSON.stringify({banned})}),
  adminDelete: (id:string) => request<{ok:true}>(`/admin/users/${id}`,{method:'DELETE',body:JSON.stringify({confirm:'DELETE ACCOUNT'})}),
  credits: () => request<{balance:number;costs:{generate:number;edit:number;studio:number};packages:{id:string;label:string;usdCents:number;credits:number}[];purchasesEnabled:boolean;ledger:{id:string;delta:number;kind:string;createdAt:string}[]}>('/credits'),
  redeemCredits: (code:string) => request<{ok:true;balance:number;added:number}>('/credits/redeem',{method:'POST',body:JSON.stringify({code})}),
  setToken: (value: string | null) => value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY),
  signup: (email: string, password: string) => request<{pendingVerification:true;message:string}>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  verifyEmail: (verificationToken:string) => request<{ok:true;message:string}>('/auth/verify',{method:'POST',body:JSON.stringify({token:verificationToken})}),
  resendVerification: (email:string,password:string) => request<{message:string}>('/auth/resend-verification',{method:'POST',body:JSON.stringify({email,password})}),
  forgotPassword: (email:string) => request<{message:string}>('/auth/forgot-password',{method:'POST',body:JSON.stringify({email})}),
  resetPassword: (resetToken:string,password:string) => request<{ok:true;message:string}>('/auth/reset-password',{method:'POST',body:JSON.stringify({token:resetToken,password})}),
  login: (email: string, password: string) => request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<{ user: User }>('/auth/me'),
  generate: (input: { prompt: string; category: string; style: string; colors: string }) => request<{ code: SiteCode }>('/ai/generate', { method: 'POST', body: JSON.stringify(input) }),
  edit: (input: { instruction: string; code: SiteCode }) => request<{ code: SiteCode }>('/ai/edit', { method: 'POST', body: JSON.stringify(input) }),
  studioPlugins: () => request<{plugins: StudioPlugin[]}>('/studio/plugins'),
  studioThreads: () => request<{threads: StudioThread[]}>('/studio/threads'),
  createStudioThread: () => request<{thread: StudioThread}>('/studio/threads', { method:'POST', body:JSON.stringify({title:'New conversation'}) }),
  studioMessages: (id:string) => request<{messages: StudioMessage[]}>(`/studio/threads/${id}/messages`),
  sendStudioMessage: (id:string,input:{message:string;pluginIds:string[];projectCode?:SiteCode}) => request<{reply:string;pluginReports:{plugin:string;report:string}[]}>(`/studio/threads/${id}/messages`,{method:'POST',body:JSON.stringify(input)}),
  deleteStudioThread: (id:string) => request<{ok:true}>(`/studio/threads/${id}`,{method:'DELETE'}),
  projects: () => request<{ projects: Project[] }>('/projects'),
  save: (input: { id?: string; name: string; code: SiteCode }) => request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  rename: (id: string, name: string) => request<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  remove: (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' })
}
