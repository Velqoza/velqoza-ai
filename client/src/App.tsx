import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { ArrowRight, ArrowUpRight, Sparkles, WandSparkles, Code2, Eye, Layers3, ShieldCheck, Zap, Menu, X, Monitor, Tablet, Smartphone, Download, Save, FolderOpen, Plus, MessageSquare, Send, LogOut, Trash2, Pencil, ChevronDown, Check, LoaderCircle, Globe2, Rocket, Palette, LayoutTemplate, ExternalLink, Copy, CircleHelp, Plug, PanelLeftClose, PanelLeftOpen, Search, BrainCircuit, Settings2, FileCode2, RotateCcw, FolderTree, UserRound, UserPlus, KeyRound, RefreshCw, UsersRound } from 'lucide-react'
import { api } from './api'
import type { Project, SiteCode, User, StudioThread, StudioMessage, StudioPlugin } from './types'

const examples = [
  'A luxury skincare brand with an editorial feel and a warm neutral palette',
  'A modern SaaS landing page for an AI productivity platform',
  'A minimal portfolio for a creative director and product designer',
  'A fine-dining restaurant website with reservations and an elegant menu'
]
const blankCode: SiteCode = { title: 'Untitled website', description: '', html: '<main><h1>Your next big idea starts here.</h1><p>Describe your vision and let VELQOZA bring it to life.</p></main>', css: 'body{font-family:Arial,sans-serif;padding:4rem;color:#171717}main{max-width:760px;margin:auto}h1{font-size:clamp(2.5rem,7vw,5rem)}', js: '' }

function getPages(code: SiteCode): Record<string,string> {
  return code.pages && Object.keys(code.pages).length ? code.pages : { 'index.html': code.html }
}
function buildDocument(code: SiteCode, filename = 'index.html', exported = false) {
  const rawHtml = getPages(code)[filename] || getPages(code)['index.html'] || code.html
  // The AI may return either a full HTML document or an HTML body fragment.
  // Avoid producing invalid nested <html> documents in either preview or ZIP.
  const hasDocument = /<!doctype\s+html|<html[\s>]/i.test(rawHtml)
  const arabic = /[\u0600-\u06FF]/.test(rawHtml)
  const direction = arabic ? 'ar' : 'en'
  const externalHead = exported ? '<link rel="stylesheet" href="styles.css">' : `<style>${code.css.replace(/<\/style/gi, '<\\/style')}</style>`
  const externalScript = exported ? '<script src="script.js"></script>' : `<script>${code.js.replace(/<\/script/gi, '<\\/script')}</script>`
  const navigator = exported ? '' : `<script>document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h)return;var m=h.match(/^\.?\/?([a-z0-9_-]+\.html)(#[^?]*)?$/i);if(m){e.preventDefault();parent.postMessage({type:'velqoza-navigate',filename:m[1].toLowerCase(),hash:m[2]||''},'*')}});</script>`
  if (hasDocument) {
    let documentHtml = rawHtml
    if (!/<html[^>]*\blang=/i.test(documentHtml)) documentHtml = documentHtml.replace(/<html([\s>])/i, `<html lang="${direction}"$1`)
    if (arabic && !/<html[^>]*\bdir=/i.test(documentHtml)) documentHtml = documentHtml.replace(/<html([\s>])/i, '<html dir="rtl"$1')
    // Insert shared assets while respecting an existing head/body.
    if (/<\/head>/i.test(documentHtml)) documentHtml = documentHtml.replace(/<\/head>/i, externalHead + '</head>')
    else documentHtml = documentHtml.replace(/<body([^>]*)>/i, `<head>${externalHead}</head><body$1>`)
    if (/<\/body>/i.test(documentHtml)) return documentHtml.replace(/<\/body>/i, externalScript + navigator + '</body>')
    return documentHtml + externalScript + navigator
  }
  return `<!doctype html><html lang="${direction}"${arabic ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeAttr(code.description)}"><title>${escapeHtml(code.title)} — ${escapeHtml(filename)}</title>${externalHead}</head><body>${rawHtml}${externalScript}${navigator}</body></html>`
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)) }
function escapeAttr(value: string) { return escapeHtml(value) }

type UsageKind='studio'|'edit'|'generate'
type UsageState=Awaited<ReturnType<typeof api.usage>>
function UsageItem({item,label,now,compact=false}:{item:UsageState['usage'][UsageKind]|undefined;label:string;now:number;compact?:boolean}) {
  if(!item)return <span style={{fontSize:12,opacity:.7}}>{label}: loading…</span>
  const remaining=Math.max(0,item.remaining)
  const ms=item.nextAvailableAt ? Math.max(0,Date.parse(item.nextAvailableAt)-now) : 0
  const until=ms ? `${Math.floor(ms/3600000)>0?Math.floor(ms/3600000)+'h ':''}${Math.ceil(ms%3600000/60000)}m` : null
  if(compact)return <span aria-live="polite" title={item.limit+' requests per two-hour rolling window'} style={{fontSize:12,opacity:.9,whiteSpace:'nowrap'}}>{label}: <strong>{remaining}/{item.limit}</strong>{until ? ' · Next in '+until : ''}</span>
  return <div style={{display:'grid',gap:6,padding:'8px 0'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:10}}><strong>{label}</strong><span>{remaining} / {item.limit} left</span></div>
    <div style={{height:7,background:'rgba(150,150,170,.25)',borderRadius:99,overflow:'hidden'}}><div style={{height:'100%',width:((remaining/item.limit)*100||0)+'%',background:'#ad8cff',borderRadius:99}}/></div>
    {until && <small style={{opacity:.76}}>Next request available in {until}</small>}
  </div>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [accountOpen,setAccountOpen]=useState(false)
  const [savedAccounts,setSavedAccounts]=useState(api.savedAccounts())
  const [accountBusy,setAccountBusy]=useState(false)
  const [accountFeedback,setAccountFeedback]=useState('')
  const [displayNameDraft,setDisplayNameDraft]=useState('')
  const [currentPassword,setCurrentPassword]=useState('')
  const [nextPassword,setNextPassword]=useState('')

  const [projects, setProjects] = useState<Project[]>([])
  const [walletBalance, setWalletBalance] = useState<number|null>(null)
  const [usageInfo,setUsageInfo] = useState<UsageState|null>(null)
  const [usageNow,setUsageNow] = useState(Date.now())
  const [usageError,setUsageError] = useState('')
  const [walletOpen, setWalletOpen] = useState(false)
  const [voucherCode,setVoucherCode] = useState('')
  const [voucherBusy,setVoucherBusy] = useState(false)
  const [voucherFeedback,setVoucherFeedback] = useState('')
  const [walletInfo, setWalletInfo] = useState<Awaited<ReturnType<typeof api.credits>>|null>(null)
  const [active, setActive] = useState<Project | null>(null)
  const [code, setCode] = useState<SiteCode | null>(null)
  const refreshUsage=async()=>{
    const token=api.token()
    if(!token)return
    try {
      const data=await api.usage()
      if(api.token()!==token)return
      setUsageInfo(data);setUsageError('');setUsageNow(Date.now())
    } catch(error) {if(api.token()===token)setUsageError(error instanceof Error?error.message:'Usage unavailable')}
  }
  useEffect(()=>{
    if(!user){setUsageInfo(null);setUsageError('');return}
    void refreshUsage()
    const interval=window.setInterval(()=>{setUsageNow(Date.now());void refreshUsage()},30000)
    return ()=>window.clearInterval(interval)
  },[user?.id])
  // Always read the authoritative balance from the API. Never debit credits in the browser.
  const refreshWallet = async () => {
    const sessionToken = api.token()
    if (!sessionToken) return
    try {
      const wallet = await api.credits()
      // Ignore an old response if a different account signed in meanwhile.
      if (api.token() !== sessionToken) return
      setWalletBalance(wallet.balance)
      setWalletInfo(wallet)
    } catch { /* The next refresh recovers from transient network errors. */ }
  }
  useEffect(() => {
    if (!user) { setWalletBalance(null);setWalletInfo(null);return }
    void refreshWallet()
  }, [user])
  const showWallet=async () => {
    setWalletOpen(true)
    try {const wallet=await api.credits();setWalletBalance(wallet.balance);setWalletInfo(wallet)} catch(e) {flash(e instanceof Error?e.message:'Could not load wallet')}
  }
  const redeemCode=async()=>{
    if(!voucherCode.trim() || voucherBusy) return
    setVoucherBusy(true);setVoucherFeedback('')
    try {
      const result=await api.redeemCredits(voucherCode.trim())
      setWalletBalance(result.balance);setVoucherCode('')
      setVoucherFeedback(`${result.added} Credits added successfully!`)
      await refreshWallet()
    } catch(e) {setVoucherFeedback(e instanceof Error ? e.message : 'Could not redeem code.')}
    finally {setVoucherBusy(false)}
  }
  const [previewPage, setPreviewPage] = useState('index.html')
  const [prompt, setPrompt] = useState('')
  const [category, setCategory] = useState('Business')
  const [style, setStyle] = useState('Modern')
  const [colors, setColors] = useState('Midnight purple and electric blue')
  const [mode, setMode] = useState<'desktop'|'tablet'|'mobile'>('desktop')
  const [tab, setTab] = useState<'builder'|'editor'|'studio'>('builder')
  const [chat, setChat] = useState('')
  const [messages, setMessages] = useState<{role:'user'|'assistant'; text:string}[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login'|'signup'|'forgot'|'reset'>('signup')
  const [emailActionToken,setEmailActionToken] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [adminOpen,setAdminOpen]=useState(false)
  const [adminData,setAdminData]=useState<Awaited<ReturnType<typeof api.adminOverview>>|null>(null)
  const [adminSearch,setAdminSearch]=useState('')
  const [adminBusy,setAdminBusy]=useState(false)
  const [adminError,setAdminError]=useState('')
  const [adminAudit,setAdminAudit]=useState<Awaited<ReturnType<typeof api.adminAudit>>['entries']>([])
  const loadAdmin=async()=>{
    try{const [summary,history]=await Promise.all([api.adminOverview(),api.adminAudit()]);setAdminData(summary);setAdminAudit(history.entries);setAdminError('')}
    catch(e){setAdminError(e instanceof Error?e.message:'Admin dashboard failed to load')}
  }
  const runAdmin=async(op:()=>Promise<unknown>)=>{setAdminBusy(true);setAdminError('');try{await op();await loadAdmin()}catch(e){setAdminError(e instanceof Error?e.message:'Action failed')}finally{setAdminBusy(false)}}
  const adjustCredits=(id:string,email:string,sign:1|-1)=>{
    const raw=window.prompt(`How many Credits to ${sign===1?'ADD to':'REMOVE from'} ${email}?`);if(raw===null)return
    const amount=Number(raw);if(!Number.isSafeInteger(amount)||amount<=0||amount>100000){setAdminError('Enter an integer from 1 to 100000.');return}
    const reason=window.prompt('Reason for the audit log (at least 3 characters):');if(!reason||reason.trim().length<3)return
    if(!window.confirm(`${sign===1?'ADD':'REMOVE'} ${amount} Credits ${sign===1?'to':'from'} ${email}?`))return
    void runAdmin(()=>api.adminCredits(id,sign*amount,reason.trim()))
  }
  const [projectName, setProjectName] = useState('')
  const [renameId, setRenameId] = useState<string|null>(null)
  const [renameValue, setRenameValue] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const studioBottomRef = useRef<HTMLDivElement>(null)
  const studioInputRef = useRef<HTMLTextAreaElement>(null)
  const editorInputRef = useRef<HTMLTextAreaElement>(null)
  const [studioThreads, setStudioThreads] = useState<StudioThread[]>([])
  const [studioActive, setStudioActive] = useState<string | null>(null)
  const [studioMessages, setStudioMessages] = useState<StudioMessage[]>([])
  const [studioInput, setStudioInput] = useState('')
  const [studioBusy, setStudioBusy] = useState(false)
  const [studioMemoryOpen,setStudioMemoryOpen] = useState(false)
  const [studioMemoryItems,setStudioMemoryItems] = useState<{id:string;content:string;createdAt:string}[]>([])
  const [studioMemoryDraft,setStudioMemoryDraft] = useState('')
  const [studioMemoryError,setStudioMemoryError] = useState('')
  const [studioPlugins, setStudioPlugins] = useState<StudioPlugin[]>([])
  const [enabledPlugins, setEnabledPlugins] = useState<string[]>([])
  const [studioSidebarOpen, setStudioSidebarOpen] = useState(true)
  const [studioPluginsOpen, setStudioPluginsOpen] = useState(false)
  const [studioAttachProject, setStudioAttachProject] = useState(false)
  const [threadSearch, setThreadSearch] = useState('')
  const [mediaOpen,setMediaOpen]=useState(false)
  const [mediaAssets,setMediaAssets]=useState<{id:string;name:string;mime:string;size:number;url:string;createdAt:string}[]>([])
  const [mediaBusy,setMediaBusy]=useState(false)
  const [chatDragActive,setChatDragActive]=useState(false)
  const [builderDragActive,setBuilderDragActive]=useState(false)
  const builderDragDepth=useRef(0)
  const chatDragDepth=useRef(0)
  const [mediaError,setMediaError]=useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishApproved, setPublishApproved] = useState(false)
  const [publishing,setPublishing] = useState(false)
  const [publishedUrl,setPublishedUrl] = useState('')
  const [siteNameInput,setSiteNameInput]=useState('')
  const [currentPublishedName,setCurrentPublishedName]=useState('')
  const [nameAvailability,setNameAvailability]=useState<'unknown'|'checking'|'available'|'taken'>('unknown')
  const [nameReason,setNameReason]=useState('')
  const [publishError,setPublishError] = useState('')
  const [publishDomainMode, setPublishDomainMode] = useState<'temporary'|'existing'|'buy'>('temporary')
  const [publishDomain, setPublishDomain] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorFile, setInspectorFile] = useState('index.html')
  const [inspectorSearch, setInspectorSearch] = useState('')
  const [sourceEditing,setSourceEditing] = useState(false)
  const [sourceDraft,setSourceDraft] = useState('')
  const [lastEditFiles,setLastEditFiles] = useState<string[]>([])
  const [historyOpen,setHistoryOpen] = useState(false)
  const [studioSendError, setStudioSendError] = useState('')
  const [draftAvailable, setDraftAvailable] = useState(false)
  const [undoStack, setUndoStack] = useState<SiteCode[]>([])
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [saveStatus, setSaveStatus] = useState<'idle'|'pending'|'saving'|'saved'|'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [saveTick, setSaveTick] = useState(0)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const workSessionRef = useRef(0)
  const activeIdRef = useRef<string | undefined>(undefined)
  const saveSnapshotRef = useRef<{code:SiteCode|null; name:string; userId:string|null}>({code:null,name:'',userId:null})
  // These are intentionally updated every render so async saves never use stale React closures.
  saveSnapshotRef.current = {code, name:projectName, userId:user?.id || null}



  // Credits are reserved on the server as soon as an AI request begins.
  // Sync while the request is in flight, and after success or refund.
  useEffect(() => {
    if (!user || (!busy && !studioBusy)) return
    void refreshWallet()
    const poll = window.setInterval(() => { void refreshWallet() }, 3000)
    return () => window.clearInterval(poll)
  }, [user, busy, studioBusy])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.type !== 'velqoza-navigate') return
      if (!code || !Object.prototype.hasOwnProperty.call(getPages(code), event.data.filename)) return
      setPreviewPage(event.data.filename)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [code])

  useEffect(() => {
    // Restore the signed-in user separately from optional project loading.
    // A temporary backend outage or failing projects endpoint must not erase the saved session.
    const sessionToken = api.token()
    if (!sessionToken) return
    let cancelled = false
    void api.me().then(async ({user}) => {
      if (cancelled) return
      setUser(user)
      api.rememberAccount(user,sessionToken);setSavedAccounts(api.savedAccounts())
      try {
        const {projects} = await api.projects()
        if (!cancelled) setProjects(projects)
      } catch (error) {
        console.warn('[VELQOZA] Could not load projects; keeping sign-in session.', error)
      }
    }).catch((error: Error & {status?: number}) => {
      if (cancelled) return
      // An actual 401/403 revokes the session. Network, timeout and 5xx failures do not.
      if (error.status === 401 || error.status === 403) { api.setToken(null); const found=api.savedAccounts().find(a=>a.token===sessionToken);if(found)api.removeSavedAccount(found.id);setSavedAccounts(api.savedAccounts()) }
      else console.warn('[VELQOZA] Session restoration temporarily unavailable.', error)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user) { setStudioThreads([]); setStudioActive(null); setStudioMessages([]); return }
    api.studioThreads().then(r => setStudioThreads(r.threads)).catch(() => {})
    api.studioPlugins().then(r => setStudioPlugins(r.plugins)).catch(() => {})
  }, [user])
  useEffect(() => { studioBottomRef.current?.scrollIntoView({behavior:'smooth',block:'end'}) }, [studioMessages, studioBusy, tab])
  useEffect(() => {
    try {
      const previous = window.localStorage.getItem('velqoza_builder_prompt_draft_v2')
      if (previous && !prompt) { setPrompt(previous); setDraftAvailable(true) }
    } catch { /* Local storage may be unavailable in private browsing. */ }
  }, [])
  useEffect(() => {
    try { if (prompt.trim()) window.localStorage.setItem('velqoza_builder_prompt_draft_v2',prompt); else window.localStorage.removeItem('velqoza_builder_prompt_draft_v2') }
    catch { /* Draft is convenience, never a dependency of the builder. */ }
  }, [prompt])
  const changed = Boolean(code && (JSON.stringify(code) !== JSON.stringify(active?.code || null) || projectName !== (active?.name || '')))
  // Server-backed autosave: debounce edits, serialize requests, and preserve new edits made mid-save.
  useEffect(() => {
    if (!code || !user || !changed) {
      if (code && !changed && saveStatus !== 'saving') setSaveStatus('saved')
      return
    }
    setSaveStatus(current => current === 'saving' ? current : 'pending')
    const timer = window.setTimeout(() => { void persistProject(false) }, 1400)
    return () => window.clearTimeout(timer)
  }, [code, projectName, user?.id, active, saveTick])

  useEffect(() => {
    if (!changed) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload',onBeforeUnload)
    return () => window.removeEventListener('beforeunload',onBeforeUnload)
  }, [changed])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && tab === 'editor') { event.preventDefault(); void saveProject() }
    }
    window.addEventListener('keydown',shortcut)
    return () => window.removeEventListener('keydown',shortcut)
  })
  function prepareBuildFromChat(content: string) {
    // Let the user review the prompt instead of launching a paid API request.
    const brief = content.trim().slice(0,8000)
    if (!brief) return
    if (changed && !window.confirm('You have unsaved website changes. Open the builder without discarding your current project? Save them first if needed.')) return
    setPrompt(brief)
    setDraftAvailable(false)
    setTab('builder')
    setMobileMenu(false)
    setStudioPluginsOpen(false)
    flash('Prompt copied into Website Builder. Review it, then click Generate.')
    window.setTimeout(() => promptTextareaRef.current?.focus(),30)
  }
  function inspectorContent(name: string): string {
    if (!code) return ''
    if (name === 'styles.css') return code.css
    if (name === 'script.js') return code.js
    if (Object.prototype.hasOwnProperty.call(getPages(code),name)) return buildDocument(code,name,true)
    return code.files?.[name] || ''
  }
  function rawFileContent(name:string):string {
    if (!code) return ''
    if (name === 'styles.css') return code.css
    if (name === 'script.js') return code.js
    return getPages(code)[name] ?? code.files?.[name] ?? ''
  }
  function applySourceEdit() {
    if (!code || !sourceEditing) return
    const name=inspectorFile
    if (sourceDraft.length > 180000) { flash('File exceeds maximum supported size.'); return }
    const before=rawFileContent(name)
    if (before===sourceDraft) {setSourceEditing(false);return}
    let next:SiteCode
    if (name==='styles.css') next={...code,css:sourceDraft}
    else if (name==='script.js') next={...code,js:sourceDraft}
    else if (Object.prototype.hasOwnProperty.call(getPages(code),name)) {
      const pages={...getPages(code),[name]:sourceDraft}
      next={...code,pages,html:pages['index.html']}
    } else next={...code,files:{...(code.files||{}),[name]:sourceDraft}}
    setUndoStack(stack=>[...stack.slice(-19),code])
    setCode(next);setLastEditFiles([name]);setSourceEditing(false)
    flash('Source updated. Review preview and save.')
  }
  const allFiles = code ? [...Object.keys(getPages(code)),'styles.css','script.js',...Object.keys(code.files||{})] : []
  const visibleFiles = allFiles.filter(name => name.toLowerCase().includes(inspectorSearch.toLowerCase()))


  async function openStudio() {
    if (!user) { setAuthMode('login'); setAuthOpen(true); flash('Sign in to use AI Studio and save your conversations.'); return }
    setTab('studio')
    try {
      const r = await api.studioThreads(); setStudioThreads(r.threads)
    } catch (e) { flash((e as Error).message) }
  }
  async function startStudioThread() {
    try {
      const result = await api.createStudioThread()
      setStudioThreads(t => [result.thread,...t]);setStudioActive(result.thread.id);setStudioMessages([])
      return result.thread.id
    } catch(e) {flash((e as Error).message);return null}
  }
  async function selectStudioThread(id:string) {
    setStudioActive(id)
    setStudioMessages([])
    try {const result=await api.studioMessages(id);setStudioMessages(result.messages)}
    catch(e){flash((e as Error).message)}
  }
  async function removeStudioThread(id:string) {
    if (!window.confirm('Delete this conversation permanently?')) return
    try { await api.deleteStudioThread(id);setStudioThreads(t=>t.filter(x=>x.id!==id));if(studioActive===id){setStudioActive(null);setStudioMessages([])} }
    catch(e){flash((e as Error).message)}
  }
  async function openStudioMemory() {
    setStudioMemoryOpen(true);setStudioMemoryError('')
    try {const result=await api.studioMemory();setStudioMemoryItems(result.memories)}
    catch(error){setStudioMemoryError(error instanceof Error?error.message:'Could not load memories.')}
  }
  async function pinStudioMemory() {
    const content=studioMemoryDraft.trim()
    if(!content)return
    setStudioMemoryError('')
    try {const r=await api.addStudioMemory(content);setStudioMemoryItems(items=>[r.memory,...items]);setStudioMemoryDraft('')}
    catch(error){setStudioMemoryError(error instanceof Error?error.message:'Could not save memory.')}
  }
  async function removeStudioMemory(id:string) {
    try {await api.deleteStudioMemory(id);setStudioMemoryItems(items=>items.filter(x=>x.id!==id))}
    catch(error){setStudioMemoryError(error instanceof Error?error.message:'Could not delete memory.')}
  }
  async function sendStudio() {
    const message = studioInput.trim()
    if (!message || studioBusy || !user) return
    setStudioBusy(true); setStudioSendError(''); setStudioInput('')
    // Keep the composer focused after sending, even while the assistant is replying.
    requestAnimationFrame(() => studioInputRef.current?.focus())
    let id=studioActive
    try {
      if (!id) id=await startStudioThread()
      if (!id) {setStudioInput(current => current || message);return}
      const stamp=new Date().toISOString()
      setStudioMessages(m=>[...m,{id:`pending-${stamp}`,role:'user',content:message,createdAt:stamp}])
      const response=await api.sendStudioMessage(id,{message,pluginIds:enabledPlugins,projectCode:studioAttachProject && code ? code : undefined})
      setStudioMessages(m=>[...m,{id:`answer-${stamp}`,role:'assistant',content:response.reply,createdAt:new Date().toISOString()}])
      const list=await api.studioThreads();setStudioThreads(list.threads)
    } catch(e) {
      flash((e as Error).message)
      setStudioSendError((e as Error).message)
      setStudioMessages(m=>m.filter(x=>!x.id.startsWith('pending-')))
      setStudioInput(current => current || message)
    } finally {setStudioBusy(false);void refreshWallet();void refreshUsage();requestAnimationFrame(() => studioInputRef.current?.focus())}
  }
  const refreshProjects = async () => {
    if (!user) return
    const result = await api.projects()
    setProjects(result.projects)
  }
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3800) }

  async function generate() {
    if (mediaBusy) { flash('Finish uploading your attachment before generating.'); return }
    if (!prompt.trim()) { flash('Describe the website you want to create first.'); return }
    setBusy(true); setTab('editor'); setMessages([])
    try {
      const result = await api.generate({ prompt: prompt.trim(), category, style, colors })
      workSessionRef.current += 1; activeIdRef.current = undefined; setSaveStatus('pending')
      setCode(result.code); setLastEditFiles([]); setUndoStack([]); setPreviewPage('index.html'); setInspectorFile('index.html'); setActive(null); setProjectName(result.code.title || 'New website')
      flash('Your website has been generated.')
    } catch (e) { flash((e as Error).message) }
    finally { setBusy(false); void refreshWallet(); void refreshUsage() }
  }
  async function editSite() {
    if (!chat.trim() || !code) return
    const instruction = chat.trim()
    setMessages(m => [...m, {role:'user', text:instruction}]); setChat(''); setBusy(true)
    requestAnimationFrame(() => editorInputRef.current?.focus())
    try {
      const result = await api.edit({ instruction, code })
      const previousPages=getPages(code),updatedPages=getPages(result.code)
      const changedNames=[
        ...new Set([...Object.keys(previousPages),...Object.keys(updatedPages)])
      ].filter(name=>previousPages[name]!==updatedPages[name])
      if(code.css!==result.code.css) changedNames.push('styles.css')
      if(code.js!==result.code.js) changedNames.push('script.js')
      for(const name of new Set([...Object.keys(code.files||{}),...Object.keys(result.code.files||{})])) {
        if(code.files?.[name]!==result.code.files?.[name]) changedNames.push(name)
      }
      if (!changedNames.length && code.title===result.code.title && code.description===result.code.description) {
        throw new Error('AI returned no changes. Your original website is unchanged.')
      }
      setUndoStack(stack=>[...stack.slice(-19),code])
      setCode(result.code);setLastEditFiles(changedNames)
      if (!Object.prototype.hasOwnProperty.call(getPages(result.code), previewPage)) setPreviewPage('index.html')
      setMessages(m => [...m, {role:'assistant', text:'Updated files: '+(changedNames.length?changedNames.join(', '):'Project details only')+'. Review preview, then Save. Use Undo AI edit to roll back.'}])
    } catch (e) { setMessages(m => [...m, {role:'assistant', text:`I couldn't apply that change: ${(e as Error).message}`}]) }
    finally { setBusy(false); void refreshWallet(); requestAnimationFrame(() => editorInputRef.current?.focus()) }
  }
  function undoLastEdit() {
    if (!undoStack.length) return
    const previous = undoStack[undoStack.length-1]
    setUndoStack(stack=>stack.slice(0,-1))
    setCode(previous)
    if (!Object.prototype.hasOwnProperty.call(getPages(previous),previewPage)) setPreviewPage('index.html')
    flash('Restored the previous version. Save to keep this change.')
  }
  async function persistProject(manual: boolean) {
    if (saveInFlightRef.current) {
      if (manual) { await saveInFlightRef.current; await persistProject(true) }
      return
    }
    const snapshot = saveSnapshotRef.current
    if (!snapshot.code) return
    if (!snapshot.userId || !api.token()) {
      if (manual) {setAuthMode('signup');setAuthOpen(true);flash('Log in to save projects.')}
      return
    }
    const session = workSessionRef.current
    const name = (snapshot.name.trim() || snapshot.code.title || 'Untitled website').slice(0,100)
    const task = (async () => {
      setSaveStatus('saving');setSaveError('')
      try {
        const result = await api.save({id: activeIdRef.current, name, code:snapshot.code!})
        if (workSessionRef.current !== session || saveSnapshotRef.current.userId !== snapshot.userId) return
        activeIdRef.current = result.project.id
        setActive(result.project)
        setProjects(current => [result.project, ...current.filter(item => item.id !== result.project.id)])
        if (manual) flash('Project saved successfully.')
        setSaveStatus('saved')
      } catch(e) {
        if (workSessionRef.current !== session) return
        const message = (e as Error).message
        setSaveStatus('error');setSaveError(message)
        if (manual) flash(`Save failed: ${message}`)
      }
    })()
    saveInFlightRef.current = task
    try { await task } finally {
      if (saveInFlightRef.current === task) saveInFlightRef.current = null
      // Re-check the latest editor state; a newer revision may have arrived mid-request.
      if (workSessionRef.current === session && (saveSnapshotRef.current.code !== snapshot.code || saveSnapshotRef.current.name !== snapshot.name)) setSaveTick(t=>t+1)
    }
  }
  async function saveProject() { await persistProject(true) }
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search)
    const verify=params.get('verify'),reset=params.get('reset')
    if(verify){
      window.history.replaceState({},'',window.location.pathname)
      void api.verifyEmail(verify).then(r=>{flash(r.message);setAuthMode('login');setAuthOpen(true)}).catch(e=>flash(e.message))
    } else if(reset){
      window.history.replaceState({},'',window.location.pathname)
      setEmailActionToken(reset);setAuthMode('reset');setAuthOpen(true)
    }
  },[])
  async function authSubmit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      if(authMode === 'forgot') {
        const r=await api.forgotPassword(authEmail);flash(r.message);setAuthMode('login');return
      }
      if(authMode === 'reset') {
        const r=await api.resetPassword(emailActionToken,authPassword);flash(r.message);setAuthMode('login');setAuthPassword('');setEmailActionToken('');return
      }
      if(authMode === 'signup') {
        const r=await api.signup(authEmail,authPassword);flash(r.message);setAuthMode('login');setAuthPassword('');return
      }
      const result=await api.login(authEmail,authPassword)
      resetWorkspaceForAccount()
      api.setToken(result.token);api.rememberAccount(result.user,result.token);setSavedAccounts(api.savedAccounts());setUser(result.user);setAuthOpen(false);setAuthPassword('')
      const p=await api.projects();setProjects(p.projects);flash('Welcome back!')
    } catch(e) { flash((e as Error).message) }
    finally { setBusy(false) }
  }
  const resetWorkspaceForAccount=()=>{
    workSessionRef.current += 1;activeIdRef.current=undefined
    setProjects([]);setActive(null);setCode(null);setProjectName('');setTab('builder')
    setStudioThreads([]);setStudioActive(null);setStudioMessages([]);setMessages([])
    setWalletBalance(null);setWalletInfo(null);setShowProjects(false);setWalletOpen(false)
    setAdminOpen(false);setSaveStatus('idle');setSaveError('');setUndoStack([])
  }
  const switchAccount=async (target:ReturnType<typeof api.savedAccounts>[number])=>{
    if(accountBusy || target.id===user?.id) return
    if((busy||studioBusy) || saveInFlightRef.current || changed) { flash('Finish your request and save project changes before switching accounts.');return }
    setAccountBusy(true);setAccountFeedback('')
    try {
      // Verify the saved session BEFORE changing global authorization or any workspace state.
      const verified=await api.validateAccountToken(target.token)
      if(verified.id!==target.id) throw new Error('Stored account does not match the verified session.')
      resetWorkspaceForAccount()
      api.setToken(target.token)
      api.rememberAccount(verified,target.token);setSavedAccounts(api.savedAccounts())
      setUser(verified);setDisplayNameDraft(verified.displayName||'')
      setAccountOpen(false)
      const p=await api.projects();setProjects(p.projects)
      flash(`Switched to ${verified.email}`)
    }catch(error){
      const err=error as Error & {status?:number}
      if(err.status===401 || err.status===403){api.removeSavedAccount(target.id);setSavedAccounts(api.savedAccounts());setAccountFeedback(`${target.email}: session expired. Add this account again.`)}
      else setAccountFeedback(err.message || 'Could not switch accounts.')
    } finally {setAccountBusy(false)}
  }
  const addAccount=()=>{
    if(busy||studioBusy||saveInFlightRef.current||changed){flash('Finish and save your project before adding an account.');return}
    setAccountOpen(false);setAuthMode('login');setAuthEmail('');setAuthPassword('');setAuthOpen(true)
  }
  const logoutCurrent=()=>{
    if((busy||studioBusy||saveInFlightRef.current||changed) && !window.confirm('An AI request or unsaved change may be lost. Sign out anyway?')) return
    if(user)api.removeSavedAccount(user.id)
    resetWorkspaceForAccount();api.setToken(null);setUser(null);setSavedAccounts(api.savedAccounts());setAccountOpen(false)
    flash('Signed out. Other saved accounts remain available from Log in.')
  }
  const saveAccountName=async()=>{
    setAccountBusy(true);setAccountFeedback('')
    try {const r=await api.updateProfile(displayNameDraft);setUser(r.user);const t=api.token();if(t)api.rememberAccount(r.user,t);setSavedAccounts(api.savedAccounts());setAccountFeedback('Profile name saved.')}
    catch(e){setAccountFeedback((e as Error).message)}finally{setAccountBusy(false)}
  }
  const updateAccountPassword=async()=>{
    if(!currentPassword||nextPassword.length<8){setAccountFeedback('Enter your current password and a new password with at least 8 characters.');return}
    setAccountBusy(true);setAccountFeedback('')
    try {const result=await api.changePassword(currentPassword,nextPassword);api.setToken(result.token);if(user)api.rememberAccount(user,result.token);setSavedAccounts(api.savedAccounts());setCurrentPassword('');setNextPassword('');setAccountFeedback('Password updated; other sessions for this account were revoked.')}
    catch(e){setAccountFeedback((e as Error).message)}finally{setAccountBusy(false)}
  }
  const signOutOtherDevices=async()=>{
    if(!window.confirm('Revoke all other sessions of this account?'))return
    setAccountBusy(true);setAccountFeedback('')
    try{const result=await api.signOutOtherDevices();api.setToken(result.token);if(user)api.rememberAccount(user,result.token);setSavedAccounts(api.savedAccounts());setAccountFeedback('Other sessions revoked.')}
    catch(e){setAccountFeedback((e as Error).message)}finally{setAccountBusy(false)}
  }
  async function resendVerification() {
    if(!authEmail || !authPassword) {flash('Enter your email and password first.');return}
    setBusy(true)
    try {const r=await api.resendVerification(authEmail,authPassword);flash(r.message)}
    catch(e) {flash((e as Error).message)} finally {setBusy(false)}
  }
  async function openProject(project: Project) {
    workSessionRef.current += 1; activeIdRef.current = project.id; setSaveStatus('saved')
    setActive(project); setCode(project.code); setLastEditFiles([]); setUndoStack([]); setPreviewPage('index.html'); setInspectorFile('index.html'); setProjectName(project.name); setTab('editor'); setMessages([]); setShowProjects(false)
  }
  async function deleteProject(id: string) {
    if (!confirm('Delete this project permanently?')) return
    try { await api.remove(id); setProjects(p => p.filter(x => x.id !== id)); if (active?.id === id) {workSessionRef.current += 1;activeIdRef.current=undefined;setActive(null);setCode(null)}; flash('Project deleted.') }
    catch(e) { flash((e as Error).message) }
  }
  async function renameProject(id: string) {
    if (!renameValue.trim()) return
    try { const {project} = await api.rename(id, renameValue.trim()); setProjects(p => p.map(x => x.id === id ? project : x)); if (active?.id === id) { setActive(project); setProjectName(project.name) }; setRenameId(null) }
    catch(e) { flash((e as Error).message) }
  }

  async function importExistingZip(file: File | undefined) {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { flash('ZIP too large (8 MB maximum).'); return }
    if (changed && !window.confirm('Importing opens a new project. Save your current changes first. Continue?')) return
    setBusy(true)
    try {
      const archive = await JSZip.loadAsync(file)
      const entries = Object.entries(archive.files).filter(([name,entry]) =>
        !entry.dir && !name.startsWith('__MACOSX/') && !name.split('/').some(x => x === '..' || x === '__proto__' || x === 'node_modules' || x === '.git'))
      if (entries.length > 80) throw new Error('Too many files in ZIP (max 80).')
      // Only code files can be imported in this first version. Binary media is rejected
      // rather than silently dropping images, sound, or video from an imported site.
      const media = entries.map(([n])=>n).filter(n => /\.(png|jpe?g|gif|webp|ico|avif|mp3|wav|ogg|mp4|webm|mov|woff2?|ttf|otf)$/i.test(n))
      if (media.length) throw new Error('This ZIP contains media (' + media.slice(0,3).join(', ') + '). Asset import is not supported yet; no files were changed.')
      const htmlNames = entries.map(([n])=>n).filter(n=>/\.html?$/i.test(n))
      if (!htmlNames.length) throw new Error('ZIP needs an index.html page.')
      const rootIndex = htmlNames.find(n => /(^|\/)index\.html$/i.test(n))
      if (!rootIndex) throw new Error('Could not find index.html in the ZIP.')
      const prefix = rootIndex.slice(0,rootIndex.length-'index.html'.length)
      const flat = entries.filter(([n])=>n.startsWith(prefix)).map(([n,entry])=>[n.slice(prefix.length),entry] as const)
        .filter(([n])=>n && !n.includes('/') && /^[a-zA-Z0-9_.-]+$/.test(n))
      const textEntries = flat.filter(([n])=>/\.(html?|css|js|json|md|txt)$/i.test(n))
      if (textEntries.length>35) throw new Error('Too many source files in ZIP.')
      const contents:Record<string,string>={}
      let total=0
      for (const [name,entry] of textEntries) {
        const value=await entry.async('string')
        total+=value.length
        if (value.length>180000 || total>550000) throw new Error('ZIP source code exceeds safe import limits.')
        contents[name]=value
      }
      const main=contents['index.html'] || contents[Object.keys(contents).find(n=>n.toLowerCase()==='index.html')||'']
      if (!main) throw new Error('index.html is missing or empty.')
      const cssNames=Object.keys(contents).filter(n=>/\.css$/i.test(n))
      const jsNames=Object.keys(contents).filter(n=>/\.js$/i.test(n))
      const primaryCss=cssNames.find(n=>n==='styles.css')||cssNames.find(n=>n==='style.css')||cssNames[0]
      const primaryJs=jsNames.find(n=>n==='script.js')||jsNames.find(n=>n==='main.js')||jsNames[0]
      // Keep the original HTML structure. The builder injects these shared sources.
      const stripExistingTags=(html:string)=>html
        .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,tag => /href=["'](?:\.\/)?[^:"']+\.css["']/i.test(tag)?'':tag)
        .replace(/<script\b[^>]*src=["'](?:\.\/)?[^:"']+\.js["'][^>]*><\/script>/gi,'')
      const pages:Record<string,string>={}
      for (const [name,value] of Object.entries(contents)) if (/\.html$/i.test(name) && Object.keys(pages).length<12) pages[name.toLowerCase()]=stripExistingTags(value)
      if (!pages['index.html']) throw new Error('Missing index.html in supported website root.')
      const extras:Record<string,string>={}
      for (const [name,value] of Object.entries(contents)) {
        if (/\.html$/i.test(name) || name===primaryCss || name===primaryJs) continue
        if (Object.keys(extras).length < 25 && /\.(css|js|json|md|txt)$/i.test(name)) extras[name]=value
      }
      const imported:SiteCode={title:file.name.replace(/\.zip$/i,'')||'Imported website',description:'Imported from an existing website ZIP. Edit it using VELQOZA AI.',html:pages['index.html'],css:primaryCss?contents[primaryCss]:'',js:primaryJs?contents[primaryJs]:'',pages,files:extras}
      workSessionRef.current+=1;activeIdRef.current=undefined;setSaveStatus('pending')
      setCode(imported);setLastEditFiles([]);setActive(null);setProjectName(imported.title);setPreviewPage('index.html')
      setInspectorFile('index.html');setUndoStack([]);setMessages([]);setTab('editor')
      flash('Website imported. Review preview and Save; unsupported nested files were not included.')
    } catch(error) { flash(error instanceof Error?error.message:'ZIP import failed.') }
    finally {setBusy(false)}
  }

  async function openMediaLibrary() {
    if(!user){setAuthMode('login');setAuthOpen(true);return}
    setMediaOpen(true);setMediaError('')
    try {const result=await api.mediaAssets();setMediaAssets(result.assets)}
    catch(error){setMediaError(error instanceof Error?error.message:'Could not load media.')}
  }
  async function uploadMediaFile(file:File|undefined, destination:'library'|'edit'|'builder'='library') {
    if(destination!=='library' && !user) {
      setMediaError('Sign in first to upload media. Your prompt will stay here.')
      setAuthMode('login');setAuthOpen(true);return
    }
    if(!file)return
    const allowed=new Set(['image/png','image/jpeg','image/webp','image/gif','audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm'])
    if(!allowed.has(file.type)||file.size>3*1024*1024||!file.size){
      setMediaError('Choose PNG, JPG, WebP, GIF, MP3, WAV, OGG, MP4 or WebM, maximum 3 MB per file.');return
    }
    setMediaBusy(true);setMediaError('')
    try {
      const dataUrl=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader()
        reader.onload=()=>resolve(String(reader.result||''))
        reader.onerror=()=>reject(new Error('Could not read the file.'))
        reader.readAsDataURL(file)
      })
      const dataBase64=dataUrl.split(',')[1]
      if(!dataBase64) throw new Error('The file was empty.')
      const {asset}=await api.uploadMedia({filename:file.name,mime:file.type,dataBase64})
      setMediaAssets(items=>[asset,...items])
      if(destination==='edit') {
        const snippet='Use the uploaded '+asset.mime+' file at '+window.location.origin+asset.url+' in this website. Preserve the other pages and functionality.'
        setChat(previous=>(previous.trim()?previous.trim()+'\n':'')+snippet)
      }
      if(destination==='builder') {
        const snippet='Include the uploaded '+asset.mime+' asset from '+window.location.origin+asset.url+' in the new website. Use the asset URL directly in appropriate HTML/CSS and make the design fit it.'
        setPrompt(previous=>(previous.trim()?previous.trim()+'\n':'')+snippet)
        setDraftAvailable(false)
      }
      flash(destination==='library'?'Media uploaded. Use its URL inside your website.':'Media attached to your AI request.')
    }catch(error){setMediaError(error instanceof Error?error.message:'Upload failed.')}
    finally {setMediaBusy(false)}
  }
  async function removeMediaAsset(id:string) {
    if(!window.confirm('Delete this media? Any published website using its URL may lose the file.')) return
    setMediaBusy(true);setMediaError('')
    try {await api.deleteMedia(id);setMediaAssets(items=>items.filter(x=>x.id!==id));flash('Media deleted.')}
    catch(error){setMediaError(error instanceof Error?error.message:'Delete failed.')}
    finally {setMediaBusy(false)}
  }
  async function openPublish() {
    setPublishOpen(true);setPublishApproved(false);setPublishError('');setPublishedUrl('')
    setSiteNameInput(slug(projectName).slice(0,40).padEnd(3,'0'))
    setNameAvailability('unknown');setNameReason('');setCurrentPublishedName('')
    const id=activeIdRef.current
    if (!id) return
    try {
      const result=await api.published(id)
      if(result.publication){
        setPublishedUrl(result.publication.url)
        if(result.publication.siteName){setSiteNameInput(result.publication.siteName);setCurrentPublishedName(result.publication.siteName)}
      }
    }
    catch(error){setPublishError(error instanceof Error?error.message:'Could not check publication status.')}
  }
  async function checkPublicationName() {
    const name=siteNameInput.trim().toLowerCase()
    setNameAvailability('checking');setNameReason('')
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)||name.length<3||name.length>40){
      setNameAvailability('taken');setNameReason('Use 3–40 lowercase letters, numbers or hyphens.');return
    }
    if(name===currentPublishedName){setNameAvailability('available');return}
    try {
      const result=await api.checkSiteName(name)
      setNameAvailability(result.available?'available':'taken');setNameReason(result.reason||'')
    } catch(error){setNameAvailability('unknown');setNameReason(error instanceof Error?error.message:'Could not check name.')}
  }
  async function publishNow() {
    if (!user || !code || !publishApproved || publishing) return
    setPublishing(true);setPublishError('')
    try {
      // The backend publishes only a saved, owned project. Ensure latest editor snapshot
      // is persisted before publishing, including any recent changes.
      await persistProject(true)
      const id=activeIdRef.current
      if (!id) throw new Error('Project has not been saved yet.')
      // Never publish an older server snapshot if the save failed or another
      // autosave was still running. Verify the exact saved revision first.
      const saved=await api.projects()
      const stored=saved.projects.find(item=>item.id===id)
      if (!stored || JSON.stringify(stored.code)!==JSON.stringify(code)) {
        throw new Error('Your latest edits are not saved yet. Click Save and try Publish again.')
      }
      const result=await api.publish(id,siteNameInput.trim().toLowerCase())
      setPublishedUrl(result.url)
      setCurrentPublishedName(result.siteName)
      setNameAvailability('available')
      flash(result.updated?'Public website updated.':'Website published!')
    } catch(error){setPublishError(error instanceof Error?error.message:'Publishing failed.')}
    finally {setPublishing(false)}
  }
  async function unpublishNow() {
    const id=activeIdRef.current
    if (!id || !publishedUrl || !window.confirm('Unpublish this site? Its public link will stop working.')) return
    setPublishing(true);setPublishError('')
    try {await api.unpublish(id);setPublishedUrl('');setCurrentPublishedName('');setNameAvailability('unknown');flash('Website unpublished.')}
    catch(error){setPublishError(error instanceof Error?error.message:'Unpublish failed.')}
    finally {setPublishing(false)}
  }
  async function downloadFiles() {
    if (!code) return
    const zip = new JSZip()
    for (const name of Object.keys(getPages(code))) zip.file(name, buildDocument(code, name, true))
    zip.file('styles.css', code.css)
    zip.file('script.js', code.js)
    // Extra source files (backend, tests, config, docs) are text-only and validated by the API.
    for (const [name, content] of Object.entries(code.files || {})) zip.file(name, content)
    if (!Object.keys(code.files || {}).some(n => n.toLowerCase() === 'readme.md')) {
      zip.file('README.md', `# ${code.title}\n\n${code.description}\n\nPages: ${Object.keys(getPages(code)).join(', ')}\nShared frontend assets: styles.css, script.js.\n\nThis export may contain backend source files. They are NOT started by the preview. Check package.json and .env.example and review generated code before installing/running. Do not deploy unreviewed code with real customer data.`)
    }
    const blob = await zip.generateAsync({type:'blob'})
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${slug(code.title)}.zip`; a.click(); URL.revokeObjectURL(url)
  }
  function downloadOne(name: string, content: string) {
    const blob = new Blob([content], {type:'text/plain;charset=utf-8'}); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url)
  }
  function openPreview() {
    if (!code) return
    const url = URL.createObjectURL(new Blob([buildDocument(code, previewPage)], {type:'text/html'}))
    window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const frameWidth = mode === 'mobile' ? '390px' : mode === 'tablet' ? '768px' : '100%'
  const projectCount = projects.length
  const filteredStudioThreads = studioThreads.filter(t=>t.title.toLowerCase().includes(threadSearch.toLowerCase()))

  return <div className="app-shell">
    <header className="topbar">
      <a href="#" className="brand" onClick={(event) => {if (changed && !window.confirm('Unsaved project changes. Leave editor?')) {event.preventDefault();return};setTab('builder');setCode(null)}}><span className="brand-mark"><Sparkles size={18}/></span><span>VELQOZA<span className="brand-ai"> AI</span></span></a>
      <nav className={`nav-links ${mobileMenu?'nav-open':''}`}>
        <button className="nav-studio" onClick={openStudio}><BrainCircuit size={16}/> AI Studio</button>
        <a href="#features" onClick={()=>setMobileMenu(false)}>Features</a><a href="#workflow" onClick={()=>setMobileMenu(false)}>How it works</a><a href="#pricing" onClick={()=>setMobileMenu(false)}>Pricing</a>
        <button className="mobile-nav-close" onClick={()=>setMobileMenu(false)}><X size={18}/></button>
      </nav>
      <div className="top-actions">
        {user ? <>{user.isAdmin && <button className="studio-top-btn" onClick={()=>{setAdminOpen(true);void loadAdmin()}}><ShieldCheck size={15}/> Admin</button>}<button className="studio-top-btn" onClick={openStudio}><MessageSquare size={15}/> Chat</button><button className="nav-projects" onClick={()=>setShowProjects(true)}><FolderOpen size={16}/> My projects <span className="count-pill">{projectCount}</span></button><button className="studio-top-btn" onClick={showWallet}><Zap size={15}/> {walletBalance===null?"Credits":`${walletBalance} Credits`}</button><button className="studio-top-btn" onClick={()=>{setDisplayNameDraft(user.displayName||'');setSavedAccounts(api.savedAccounts());setAccountOpen(true)}}><UserRound size={15}/> Account</button><button className="avatar" title="Account Control / Switch Account" aria-label="Open Account Control" onClick={()=>{setDisplayNameDraft(user.displayName||'');setAccountFeedback('');setSavedAccounts(api.savedAccounts());setAccountOpen(true)}}>{(user.displayName||user.email).slice(0,1).toUpperCase()}</button><button className="icon-btn" title="Log out" onClick={logoutCurrent}><LogOut size={17}/></button></> : <><button className="text-btn" onClick={()=>{setAuthMode('login');setAuthOpen(true)}}>Log in</button><button className="small-cta" onClick={()=>{setAuthMode('signup');setAuthOpen(true)}}>Get started <ArrowUpRight size={15}/></button></>}
      </div>
      <button className="mobile-menu-btn" onClick={()=>setMobileMenu(!mobileMenu)}><Menu/></button>
    </header>

    {tab === 'studio' ? <main className="studio-shell">
      <div className={`studio-sidebar ${studioSidebarOpen?'':'hidden'}`}>
        <div className="studio-branding"><div className="studio-brand-icon"><Sparkles size={19}/></div><span><strong>VELQOZA Studio</strong><small>YOUR AI WORKSPACE</small></span><button className="studio-sidebar-toggle" onClick={()=>setStudioSidebarOpen(false)} title="Collapse sidebar"><PanelLeftClose size={18}/></button></div>
        <button className="studio-new-btn" onClick={startStudioThread}><Plus size={16}/> New conversation <span>⌘</span></button>
        <div className="studio-search"><Search size={14}/><input value={threadSearch} onChange={e=>setThreadSearch(e.target.value)} placeholder="Search conversations" /></div>
        <div className="studio-side-label">RECENT CONVERSATIONS <span>{studioThreads.length}</span></div>
        <div className="studio-thread-list">{filteredStudioThreads.length===0 ? <p className="studio-empty-threads">Your conversations will appear here.</p> : filteredStudioThreads.map(t=><div className={`studio-thread ${studioActive===t.id?'selected':''}`} key={t.id}><button onClick={()=>selectStudioThread(t.id)} title={t.title}><MessageSquare size={14}/><span>{t.title}</span></button><button className="studio-delete" onClick={()=>removeStudioThread(t.id)} title="Delete conversation"><Trash2 size={14}/></button></div>)}</div>
        <div className="studio-side-bottom"><button onClick={()=>{if(changed && !window.confirm('Unsaved changes. Leave editor?'))return;setTab('builder');setCode(null)}}><LayoutTemplate size={16}/> Website Builder <ArrowUpRight size={14}/></button><button onClick={()=>{setShowProjects(true)}}><FolderOpen size={16}/> My Projects <span>{projectCount}</span></button><div className="studio-profile"><span className="studio-profile-icon">{user?.email.charAt(0).toUpperCase()}</span><span>{user?.email}<small>Local development workspace</small></span></div></div>
      </div>
      <div className="studio-main">
        <div className="studio-toolbar"><div className="studio-toolbar-start">{!studioSidebarOpen&&<button onClick={()=>setStudioSidebarOpen(true)} title="Open sidebar"><PanelLeftOpen size={18}/></button>}<span className="studio-current">VELQOZA AI <ChevronDown size={13}/></span><span className="studio-beta">STUDIO</span></div><div className="studio-toolbar-actions"><button onClick={()=>void openStudioMemory()} title="Review or delete automatically saved memory"><BrainCircuit size={16}/> Manage memory</button><button className={studioPluginsOpen?'active':''} onClick={()=>setStudioPluginsOpen(v=>!v)}><Plug size={16}/> Plugins {enabledPlugins.length>0&&<b>{enabledPlugins.length}</b>}</button><button onClick={()=>{setStudioAttachProject(v=>!v)}} className={studioAttachProject&&code?'active':''}><Layers3 size={16}/>{studioAttachProject&&code?'Project attached':'Project context'}</button></div></div>
        {studioMemoryOpen && <div className="studio-plugin-drawer" style={{padding:16}}>
          <div className="studio-drawer-title"><div><span>ACCOUNT MEMORY</span><h3>What VELQOZA remembers</h3><p>VELQOZA automatically recalls relevant previous chats and some durable preferences. This panel lets you inspect, add, or delete saved facts. Not every past detail can be remembered.</p></div><button onClick={()=>setStudioMemoryOpen(false)} title="Close memory"><X size={18}/></button></div>
          <div style={{display:'flex',gap:8,margin:'12px 0',flexWrap:'wrap'}}>
            <input aria-label="New memory" value={studioMemoryDraft} maxLength={500} onChange={e=>setStudioMemoryDraft(e.target.value)} placeholder="e.g. My brand is VELQOZA; I prefer dark designs" style={{flex:1,minWidth:200,background:'#211a2c',color:'#f8f5ff',padding:10,border:'1px solid #786098',borderRadius:8}}/>
            <button className="outline-btn" disabled={studioMemoryDraft.trim().length<3} onClick={()=>void pinStudioMemory()}><Plus size={15}/> Save memory</button>
          </div>
          {studioMemoryError && <p role="alert" style={{color:'#f5a1a1'}}>{studioMemoryError}</p>}
          <div style={{display:'grid',gap:9}}>{studioMemoryItems.length===0?<p>No pinned memories yet.</p>:studioMemoryItems.map(item=><div key={item.id} style={{display:'flex',alignItems:'center',gap:10,padding:10,border:'1px solid rgba(255,255,255,.12)',borderRadius:8}}><span style={{flex:1,overflowWrap:'anywhere'}}>{item.content}</span><button onClick={()=>void removeStudioMemory(item.id)} title="Delete this memory"><X size={15}/></button></div>)}</div>
        </div>}
        {studioPluginsOpen && <div className="studio-plugin-drawer"><div className="studio-drawer-title"><div><span>TOOLS & EXTENSIONS</span><h3>Built-in plugins</h3><p>Enable local analysis tools. External services aren't connected.</p></div><button onClick={()=>setStudioPluginsOpen(false)} title="Close"><X size={18}/></button></div><div className="studio-plugin-grid">{studioPlugins.map(pl=><label className={`studio-plugin ${enabledPlugins.includes(pl.id)?'enabled':''}`} key={pl.id}><span className="studio-plugin-icon">{pl.id==='seo-audit'?<Search size={19}/>:pl.id==='accessibility'?<ShieldCheck size={19}/>:pl.id==='project-map'?<Layers3 size={19}/>:<Rocket size={19}/>}</span><span className="studio-plugin-copy"><strong>{pl.name}</strong><small>{pl.description}{pl.needsProject?' Requires attached project.':''}</small></span><input type="checkbox" checked={enabledPlugins.includes(pl.id)} onChange={e=>setEnabledPlugins(ids=>e.target.checked?[...ids,pl.id]:ids.filter(x=>x!==pl.id))}/></label>)}</div></div>}
        <div className="studio-conversation">
          {studioMessages.length === 0 ? <div className="studio-welcome"><div className="studio-orb"><Sparkles size={34}/></div><span className="studio-overline">CREATIVE INTELLIGENCE</span><h1>What will we <span>create today?</span></h1><p>Ask anything, plan a project, debug your code, or brainstorm your next big idea. Your conversations stay organized in your account.</p><div className="studio-prompt-grid">{[['Plan a website','Help me plan a premium barbershop website.'],['Debug my code','Help me troubleshoot a JavaScript error.'],['Improve my design','What makes a website feel premium and cinematic?'],['Launch checklist','Give me a practical checklist for launching a small business website.']].map(([title,content])=><button key={title} onClick={()=>setStudioInput(content)}><Sparkles size={15}/><strong>{title}</strong><span>{content}</span><ArrowUpRight size={15}/></button>)}</div></div> : <div className="studio-messages">{studioMessages.map((m,i)=><article className={`studio-bubble-row ${m.role}`} key={m.id||i}><div className="studio-bubble-avatar">{m.role==='user'?(user?.email.charAt(0).toUpperCase()||'U'):<Sparkles size={17}/>}</div><div className="studio-bubble"><div className="studio-bubble-name">{m.role==='user'?'YOU':'VELQOZA AI'}</div><div className="studio-bubble-text"><StudioContent content={m.content} onCopy={()=>flash("Code copied.")}/></div>{m.role==='assistant'&&<div className="studio-message-actions"><button className="studio-copy" onClick={()=>{navigator.clipboard.writeText(m.content);flash('Copied to clipboard.')}}><Copy size={13}/> Copy</button><button className="studio-build-btn" onClick={()=>prepareBuildFromChat(m.content)} title="Use this response as your next website prompt"><WandSparkles size={14}/> Build this project <ArrowUpRight size={13}/></button></div>}</div></article>)}{studioBusy&&<div className="studio-thinking"><span/><span/><span/> Thinking through your request...</div>}<div ref={studioBottomRef}/></div>}
        </div>
        <div className="studio-compose-wrap">{studioSendError && <div className="studio-send-error" role="alert">{studioSendError}<button onClick={()=>setStudioSendError('')}>Dismiss</button></div>}<div className="studio-compose"><textarea ref={studioInputRef} value={studioInput} rows={3} onChange={e=>setStudioInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!studioBusy)sendStudio()}}} placeholder={studioBusy?"You can type your next message while AI responds...":"Message VELQOZA AI..."} aria-label="Chat message" /><div className="studio-compose-bottom"><div><span><Sparkles size={13}/> AI Studio</span><UsageItem compact item={usageInfo?.usage.studio} label="Messages left" now={usageNow}/>{enabledPlugins.length>0&&<span><Plug size={13}/> {enabledPlugins.length} tools enabled</span>}{studioAttachProject&&code&&<span><Layers3 size={13}/> {code.title}</span>}</div><button onClick={sendStudio} disabled={studioBusy||!studioInput.trim()} aria-label="Send message">{studioBusy?<LoaderCircle className="spin" size={17}/>:<Send size={17}/>}</button></div></div><p className="studio-disclaimer">AI can make mistakes. Chat replies do not automatically change your website or execute code.</p></div>
      </div>
    </main> : tab === 'builder' || !code ? <main>
      <section className="hero">
        <div className="hero-glow glow-one"/><div className="hero-glow glow-two"/>
        <div className="eyebrow"><span className="live-dot"/> BUILD WITH CREDITS · PAY AS YOU CREATE <span className="eyebrow-line"/></div>
        <h1>Turn your ideas into<br/><span className="gradient-text">websites with AI.</span></h1>
        <p className="hero-sub">Build polished websites with AI, edit by chat, and keep every project in your workspace. Credits are required for AI generation, edits and chat. No recurring subscription.</p>
        <div className="commercial-banner"><Zap size={15}/> AI WEBSITE GENERATION · 20 CREDITS <span>·</span> EDITS · 8 CREDITS <span>·</span> STUDIO CHAT · 2 CREDITS <a href="#pricing">View credit packs →</a></div><div className="prompt-card" style={{position:'relative',border:builderDragActive?'2px dashed #b59bff':undefined}}
          onDragEnter={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();builderDragDepth.current++;setBuilderDragActive(true)}}
          onDragOver={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();e.dataTransfer.dropEffect='copy'}}
          onDragLeave={e=>{e.preventDefault();builderDragDepth.current=Math.max(0,builderDragDepth.current-1);if(builderDragDepth.current===0)setBuilderDragActive(false)}}
          onDrop={e=>{e.preventDefault();e.stopPropagation();builderDragDepth.current=0;setBuilderDragActive(false);if(mediaBusy)return;const file=e.dataTransfer.files?.[0];if(file)void uploadMediaFile(file,'builder')}}>
          {builderDragActive && <div aria-hidden="true" style={{position:'absolute',inset:0,zIndex:5,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(18,12,35,.94)',color:'#f7f3ff',borderRadius:14,pointerEvents:'none',fontWeight:700}}>Drop media to attach to new website prompt</div>}
          <div className="prompt-top"><span className="prompt-label"><WandSparkles size={15}/> START WITH A PROMPT</span><span className="secure-label"><ShieldCheck size={13}/> Credits required</span></div>
          <textarea ref={promptTextareaRef} value={prompt} onChange={e=>{setPrompt(e.target.value);setDraftAvailable(false)}} placeholder="I want a premium website for my creative studio. It should feel bold, minimal, and have a striking hero section..." rows={3}/>
          <p style={{fontSize:12,opacity:.74,padding:'0 15px 6px'}}>Drag & drop media here or click Attach media. Files up to 3 MB; they upload to your account and their URL is added to this prompt.</p>
          {mediaError && <p role="alert" style={{fontSize:12,color:'#f4a7a7',padding:'0 15px 8px'}}>{mediaError}</p>}
          {draftAvailable && <div className="prompt-draft-label"><RotateCcw size={13}/> Your last unfinished prompt was restored <button onClick={()=>{setPrompt('');setDraftAvailable(false)}}>Clear</button></div>}
          <div style={{padding:'8px 14px',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><UsageItem compact item={usageInfo?.usage.generate} label="Generations left" now={usageNow}/></div>
          <div className="prompt-controls">
            <div className="selects">
              <label><LayoutTemplate size={14}/><select value={category} onChange={e=>setCategory(e.target.value)}>{['Business','Portfolio','E-commerce','Restaurant','Blog','Agency','Landing Page','SaaS','Other'].map(x=><option key={x}>{x}</option>)}</select><ChevronDown size={13}/></label>
              <label><Palette size={14}/><select value={style} onChange={e=>setStyle(e.target.value)}>{['Minimal','Modern','Luxury','Futuristic','Creative'].map(x=><option key={x}>{x}</option>)}</select><ChevronDown size={13}/></label>
            </div>
            <label className="outline-btn" style={{cursor:mediaBusy?'wait':'pointer'}} title="Attach media to your new website prompt"><Plus size={15}/> {mediaBusy?'Uploading…':'Attach media'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,video/mp4,video/webm" hidden disabled={mediaBusy} onChange={e=>{void uploadMediaFile(e.target.files?.[0],'builder');e.target.value=''}}/></label>
            <label className="outline-btn" style={{cursor:'pointer'}} title="Import existing HTML/CSS/JavaScript website ZIP"><FolderOpen size={15}/> Import ZIP<input type="file" accept=".zip,application/zip" hidden onChange={e=>{void importExistingZip(e.target.files?.[0]);e.target.value=''}}/></label>
            <button className="generate-btn" onClick={generate} disabled={busy||mediaBusy}>{busy?<><LoaderCircle className="spin" size={17}/> Creating...</>:<>Generate website <Sparkles size={16}/></>}</button>
          </div>
          <div className="color-row"><span>COLOR DIRECTION</span><input value={colors} onChange={e=>setColors(e.target.value)} aria-label="Color direction"/><span className="color-swatch swatch-purple"/><span className="color-swatch swatch-blue"/><span className="color-swatch swatch-ink"/></div>
        </div>
        <div className="studio-hero-link"><button onClick={openStudio}><BrainCircuit size={18}/> Or open AI Studio — chat, plan, and use plugins <ArrowRight size={17}/></button></div>
        <div className="examples"><span>TRY AN IDEA</span>{examples.map((x,i)=><button key={x} onClick={()=>setPrompt(x)}>{x}<ArrowUpRight size={12}/></button>)}</div>
        <div className="hero-meta"><div className="avatar-stack"><span>V</span><span>A</span><span>✦</span></div><span>Made for creators, founders & dreamers</span><span className="meta-sep">·</span><span><Zap size={13}/> AI-powered creation</span></div>
      </section>

      <section className="trust-strip"><span>ONE PROMPT. ENDLESS POSSIBILITIES.</span><div><span>DESIGN</span><i/><span>DEVELOP</span><i/><span>DEPLOY</span></div></section>

      <section id="features" className="section features-section">
        <div className="section-kicker">THE CREATIVE ADVANTAGE</div><div className="section-heading-row"><h2>Everything you need.<br/><span className="muted-gradient">Nothing in your way.</span></h2><p>A complete creative workflow, powered by AI and designed to keep you in control.</p></div>
        <div className="feature-grid">
          <Feature icon={<WandSparkles/>} number="01" title="Ideas to websites" text="Turn natural language into complete, polished websites with real HTML, CSS and JavaScript."/>
          <Feature icon={<Eye/>} number="02" title="Live visual preview" text="See every change instantly. Switch between desktop, tablet and mobile layouts as you build."/>
          <Feature icon={<MessageSquare/>} number="03" title="Edit with conversation" text="Tell your AI assistant what to change. Your existing design evolves with every instruction."/>
          <Feature icon={<Code2/>} number="04" title="Your code, always" text="Download clean source files or export the complete project as a ZIP. No lock-in."/>
          <Feature icon={<Layers3/>} number="05" title="Projects that stay yours" text="Save your work, reopen previous builds and keep every idea organized in one workspace."/>
          <Feature icon={<BrainCircuit/>} number="06" title="AI Studio + tools" text="Keep conversations, plan new ideas and use opt-in local project audit plugins."/>
        </div>
      </section>

      <section id="workflow" className="section workflow-section">
        <div className="section-kicker">A BETTER WAY TO BUILD</div><h2>From blank page to<br/><span className="gradient-text">brand new website.</span></h2>
        <div className="steps">
          <Step n="01" title="Describe it" text="Share your idea, choose a category, and set the visual direction."/>
          <Step n="02" title="Generate it" text="The AI turns your brief into a complete website and working code."/>
          <Step n="03" title="Make it yours" text="Preview, refine with chat, save your project and export your code."/>
        </div>
      </section>

      <section id="pricing" className="section pricing-section">
        <div className="section-kicker">PAY AS YOU BUILD</div><h2>Build more. <span className="muted-gradient">Pay only when you create.</span></h2>
        <p className="pricing-intro">No recurring subscription. Buy a credit pack when you need one, then use credits for AI generation, edits and AI Studio conversations. These are preview prices; online checkout is not available yet.</p>
        <div className="pricing-grid">
          {[{label:'Starter',credits:100,usdCents:2500},{label:'Pro',credits:300,usdCents:5900},{label:'Business',credits:700,usdCents:11900},{label:'Agency',credits:1600,usdCents:24900}].map((pack, index) => <article className={`pricing-tier ${index===1?'pricing-tier-featured':''}`} key={pack.label}>
            <span className="plan-label">{pack.label.toUpperCase()}</span>
            <div className="pricing-tier-price">${(pack.usdCents/100).toFixed(0)} <small>one-time</small></div>
            <strong className="pricing-tier-credits"><Zap size={17}/> {pack.credits.toLocaleString()} Credits</strong>
            <p>{Math.floor(pack.credits/20)} full website builds, or spend your credits on edits and AI chat.</p>
            <button type="button" className="pricing-tier-action" onClick={()=>{if(user) void showWallet();else {setAuthMode('signup');setAuthOpen(true)}}}>{user?'View credits':'Create account'} <ArrowUpRight size={15}/></button>
          </article>)}
        </div>
        <div className="pricing-explainer"><ShieldCheck size={19}/><div><strong>Clear usage. No surprise auto-charges.</strong><p>Generate a website: 20 Credits · Edit an existing website: 8 Credits · AI Studio message: 2 Credits. Rates and packs are provisional. Prepaid codes are available only after manual confirmation by VELQOZA; clicking a package will not charge you.</p></div></div>
      </section>
      <footer className="footer"><a href="#" className="brand"><span className="brand-mark"><Sparkles size={17}/></span>VELQOZA<span className="brand-ai"> AI</span></a><span>Build beyond imagination.</span><span>© {new Date().getFullYear()} VELQOZA AI</span></footer>
    </main> : <main className="workspace">
      <div className="workspace-head"><div><button className="back-link" onClick={()=>setTab('builder')}>← Back to home</button><div className="project-title"><input value={projectName} onChange={e=>setProjectName(e.target.value)} aria-label="Project name"/><span className={`saved-indicator ${changed?'has-changes':''}`} title={saveError || 'Automatically saved to your account'}>{!user?'LOGIN TO SAVE':saveStatus==='error'?'SAVE FAILED — RETRY':saveStatus==='saving'?'SAVING…':changed?'AUTO-SAVE PENDING':'ALL CHANGES SAVED'}</span></div></div><div className="workspace-actions"><button className="outline-btn" onClick={()=>void openMediaLibrary()}><FolderOpen size={15}/> Media</button><label className="outline-btn" style={{cursor:'pointer'}} title="Import existing HTML/CSS/JavaScript website ZIP"><FolderOpen size={15}/> Import ZIP<input type="file" accept=".zip,application/zip" hidden onChange={e=>{void importExistingZip(e.target.files?.[0]);e.target.value=''}}/></label><button className="outline-btn" onClick={undoLastEdit} disabled={!undoStack.length} title="Restore the previous AI edit (this session)"><RotateCcw size={15}/> Undo AI edit</button><button className="outline-btn" onClick={()=>setHistoryOpen(v=>!v)}><RotateCcw size={15}/> History ({undoStack.length})</button><button className="outline-btn" onClick={()=>setInspectorOpen(v=>!v)}><FolderTree size={15}/> Files</button><button className="outline-btn" onClick={saveProject}><Save size={15}/> Save</button><button className="outline-btn" onClick={openPreview}><ExternalLink size={15}/> Open</button><button className="download-btn" onClick={()=>void openPublish()}><Rocket size={15}/> Publish</button><button className="download-btn" onClick={downloadFiles}><Download size={15}/> Export ZIP</button></div></div>
      <div className="workspace-grid">
        <aside className="assistant-panel">
          <div className="assistant-title"><div className="assistant-icon"><Sparkles size={16}/></div><div><strong>VELQOZA assistant</strong><small>AI DESIGN PARTNER</small></div><span className="online-dot"/></div>
          <div className="assistant-context"><span className="context-label">CURRENT PROJECT</span><strong>{code.title}</strong><p>{code.description || 'Your website is ready to refine.'}</p></div>
          <div className="chat-area">
            {messages.length===0 ? <div className="chat-empty"><div className="chat-spark"><WandSparkles size={22}/></div><strong>What should we improve?</strong><p>Ask for a change and I'll update your existing website code.</p><div className="suggestions">{['Make the design more premium','Add a pricing section','Improve mobile responsiveness','Use a darker color palette'].map(s=><button key={s} onClick={()=>setChat(s)}>{s}<ArrowUpRight size={12}/></button>)}</div></div> : messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}><span>{m.role==='user'?'YOU':'VELQOZA AI'}</span><p>{m.text}</p></div>)}
            {busy && <div className="typing"><span/><span/><span/> Updating your website...</div>}
          </div>
          {lastEditFiles.length>0 && <div style={{fontSize:12,padding:'10px 14px',borderTop:'1px solid rgba(255,255,255,.1)'}}>Changed: {lastEditFiles.join(', ')} <button onClick={()=>{setInspectorOpen(true);setInspectorFile(lastEditFiles[0]);setSourceEditing(false)}}>Review files</button></div>}
          <div className="chat-composer" style={{position:'relative',border:chatDragActive?'2px dashed #b59bff':undefined,background:chatDragActive?'rgba(130,90,205,.18)':undefined}}
            onDragEnter={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();chatDragDepth.current++;setChatDragActive(true)}}
            onDragOver={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();e.dataTransfer.dropEffect='copy'}}
            onDragLeave={e=>{e.preventDefault();chatDragDepth.current=Math.max(0,chatDragDepth.current-1);if(chatDragDepth.current===0)setChatDragActive(false)}}
            onDrop={e=>{e.preventDefault();e.stopPropagation();chatDragDepth.current=0;setChatDragActive(false);if(mediaBusy)return;const file=e.dataTransfer.files?.[0];if(file)void uploadMediaFile(file,'edit')}}>
            {chatDragActive && <div aria-hidden="true" style={{position:'absolute',inset:0,zIndex:3,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:12,background:'rgba(18,12,35,.93)',color:'#f7f3ff',fontWeight:700,pointerEvents:'none'}}>Drop image, audio or video here</div>}
            <textarea ref={editorInputRef} value={chat} onChange={e=>setChat(e.target.value)} placeholder="Tell me what you'd like to change, or drop media here..." rows={3} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy&&!mediaBusy)editSite()}}}/>
            <div><span>{mediaBusy?'Uploading attachment…':'↵ Enter to send · drag media here'}</span><label title="Attach image, audio or video" style={{display:'inline-flex',alignItems:'center',cursor:mediaBusy?'wait':'pointer',padding:'6px 9px',borderRadius:8}}><Plus size={16}/><input type="file" hidden disabled={mediaBusy} accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,video/mp4,video/webm" onChange={e=>{void uploadMediaFile(e.target.files?.[0],'edit');e.target.value=''}}/></label><button onClick={editSite} disabled={busy||mediaBusy||!chat.trim()}><Send size={15}/></button></div>
            {mediaError && <p role="alert" style={{fontSize:12,color:'#f4a7a7',padding:'0 9px 8px'}}>{mediaError}</p>}
          </div>
          <div className="assistant-foot" style={{display:'flex',gap:8,flexWrap:'wrap'}}><ShieldCheck size={13}/> Your changes are generated securely through the server. <UsageItem compact item={usageInfo?.usage.edit} label="Edits left" now={usageNow}/></div>
        </aside>
        <section className="preview-panel">
          <div className="preview-toolbar"><div className="preview-status"><span className="live-dot"/> LIVE PREVIEW <span className="preview-divider"/> <span>{code.title}</span></div><div className="device-switch">{([['desktop',Monitor],['tablet',Tablet],['mobile',Smartphone]] as const).map(([m,Icon])=><button key={m} className={mode===m?'selected':''} onClick={()=>setMode(m)} title={`${m} preview`}><Icon size={16}/></button>)}</div><button className="icon-btn" title="Open in new tab" onClick={openPreview}><ArrowUpRight size={17}/></button></div>
          <div className="page-picker" aria-label="Website pages"><span>Pages</span>{Object.keys(getPages(code)).map(name => <button key={name} className={previewPage === name ? 'active' : ''} onClick={() => setPreviewPage(name)}>{name}</button>)}</div>
          {Object.keys(code.files || {}).length > 0 && <div className="project-file-list"><strong>Project source ({Object.keys(code.files || {}).length} extra files)</strong><span>Backend &amp; tests are included in ZIP but not executed in this frontend preview.</span><div className="project-file-items">{Object.entries(code.files || {}).map(([name, content]) => <button key={name} onClick={()=>downloadOne(name.split('/').pop() || name, content)} title={`Download ${name}`}>{name} ↓</button>)}</div></div>}
          {historyOpen && <div style={{padding:14,borderBottom:'1px solid rgba(255,255,255,.12)'}}><strong>Version history (current session)</strong><p style={{fontSize:12,opacity:.75}}>Previous edits are kept in this session only. They are not yet permanent version history.</p><div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>{undoStack.slice().reverse().map((version,index)=><button className="outline-btn" key={index} onClick={()=>{if(!window.confirm('Restore this earlier snapshot? Current unsaved code will be replaced.'))return;setCode(version);setUndoStack(stack=>stack.slice(0,stack.length-index-1));setHistoryOpen(false);flash('Snapshot restored. Save to keep changes.')}}>Version {undoStack.length-index}</button>)}</div></div>}
          {inspectorOpen && <div className="source-explorer"><div className="source-explorer-tree"><div className="source-explorer-heading"><FolderTree size={15}/> PROJECT FILES <span>{allFiles.length}</span></div><input type="search" aria-label="Filter project files" placeholder="Find a file..." value={inspectorSearch} onChange={e=>setInspectorSearch(e.target.value)}/><div className="source-explorer-files">{visibleFiles.map(name=><button key={name} className={inspectorFile===name?'selected':''} onClick={()=>{setInspectorFile(name);setSourceEditing(false)}}><FileCode2 size={13}/>{name}</button>)}</div></div><div className="source-explorer-code"><div className="source-explorer-bar"><strong>{inspectorFile}</strong><div>{sourceEditing ? <><button onClick={applySourceEdit}><Check size={14}/> Apply changes</button><button onClick={()=>setSourceEditing(false)}>Cancel</button></> : <button onClick={()=>{setSourceDraft(rawFileContent(inspectorFile));setSourceEditing(true)}}><Pencil size={14}/> Edit</button>}<button onClick={()=>{navigator.clipboard.writeText(inspectorContent(inspectorFile));flash('Source copied.')}} title="Copy file"><Copy size={14}/> Copy</button><button onClick={()=>downloadOne(inspectorFile.split('/').pop()||inspectorFile,inspectorContent(inspectorFile))} title="Download file"><Download size={14}/></button><button onClick={()=>setInspectorOpen(false)} title="Close file explorer"><X size={15}/></button></div></div>{sourceEditing ? <textarea aria-label="Edit source code" value={sourceDraft} onChange={e=>setSourceDraft(e.target.value)} spellCheck={false} style={{width:'100%',height:340,resize:'vertical',background:'#11121a',color:'#e9e9f4',fontFamily:'monospace',fontSize:12,padding:12,border:'1px solid #414159',borderRadius:8}}/> : <pre><code>{inspectorContent(inspectorFile)}</code></pre>}</div></div>}
          <div className="preview-stage"><div className={`preview-frame ${mode}`} style={{width:frameWidth}}><iframe ref={iframeRef} title="Generated website preview" sandbox="allow-scripts" srcDoc={buildDocument(code, previewPage)} /></div></div>
          <div className="code-footer"><div><span className="code-live-dot"/> Frontend preview only · backend code is not running</div><div className="code-actions"><button onClick={()=>downloadOne(previewPage,buildDocument(code, previewPage, true))}><Download size={13}/> Page</button><button onClick={()=>downloadOne('styles.css',code.css)}><Download size={13}/> CSS</button><button onClick={()=>downloadOne('script.js',code.js)}><Download size={13}/> JS</button><button onClick={downloadFiles}><Download size={13}/> ZIP</button></div></div>
        </section>
      </div>
    </main>}

    {notice && <div className="toast"><Check size={16}/>{notice}</div>}
    {accountOpen && user && <div className="modal-backdrop" onClick={()=>setAccountOpen(false)}><section className="account-control-panel" onClick={e=>e.stopPropagation()} aria-label="Account Control"><div className="modal-head"><div><span className="section-kicker">VELQOZA IDENTITY</span><h2>Account Control</h2><p>Manage your profile, sessions and saved accounts securely.</p></div><button className="icon-btn" onClick={()=>setAccountOpen(false)}><X/></button></div>
      <div className="account-summary"><div className="account-symbol">{(user.displayName||user.email).slice(0,1).toUpperCase()}</div><div><strong>{user.displayName||'Your VELQOZA account'}</strong><span>{user.email}</span><small>{user.emailVerified?'✓ Verified email':'Legacy account · email not independently verified'}{user.isAdmin?' · Owner':''}</small></div><span className="account-credits">{walletBalance??'—'} Credits</span></div>
      <section style={{padding:'16px',margin:'14px 0',background:'rgba(120,90,170,.1)',border:'1px solid rgba(170,145,210,.2)',borderRadius:14}}>
        <h3 style={{margin:'0 0 10px'}}>Your AI usage · rolling {usageInfo?.windowHours??2}-hour window</h3>
        {usageError && <p style={{fontSize:12,color:'#ffb0b0'}}>{usageError} <button onClick={()=>void refreshUsage()}>Retry</button></p>}
        <UsageItem item={usageInfo?.usage.studio} label="AI Studio Messages" now={usageNow}/>
        <UsageItem item={usageInfo?.usage.edit} label="Website Edits" now={usageNow}/>
        <UsageItem item={usageInfo?.usage.generate} label="Website Generations" now={usageNow}/>
        <p style={{fontSize:12,opacity:.77,marginTop:10}}>Limits roll forward after each request's two-hour window. Credits are charged separately.</p>
      </section>
      <div className="account-control-grid"><section><h3><UsersRound size={16}/> Switch Account</h3><p>Saved accounts on this browser. Each keeps separate projects, chats and credits.</p><div className="account-entries">{savedAccounts.map(a=><div className="account-entry" key={a.id}><span className="account-mini-avatar">{(a.displayName||a.email).slice(0,1).toUpperCase()}</span><div><strong>{a.displayName||a.email}</strong><small>{a.email}</small></div>{a.id===user.id?<span className="account-current">Active</span>:<><button disabled={accountBusy||busy||studioBusy} onClick={()=>void switchAccount(a)}>Switch</button><button title="Remove from this browser (does not delete account)" className="account-remove" onClick={()=>{api.removeSavedAccount(a.id);setSavedAccounts(api.savedAccounts())}}><X size={13}/></button></>}</div>)}</div><button className="account-outline" disabled={accountBusy||busy||studioBusy} onClick={addAccount}><UserPlus size={16}/> Add another account</button><button className="account-muted" onClick={()=>{api.clearSavedAccounts();if(user&&api.token())api.rememberAccount(user,api.token()!);setSavedAccounts(api.savedAccounts());setAccountFeedback('Other saved accounts removed from this browser.')}}>Forget other saved accounts</button></section>
      <section><h3><Settings2 size={16}/> Profile & security</h3><p>Only your account can update these settings.</p><label className="account-field">Display name<input maxLength={60} value={displayNameDraft} onChange={e=>setDisplayNameDraft(e.target.value)} placeholder="Your name" /></label><button className="account-outline" disabled={accountBusy} onClick={()=>void saveAccountName()}>Save name</button><div className="account-divider"/><label className="account-field">Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></label><label className="account-field">New password<input type="password" autoComplete="new-password" minLength={8} value={nextPassword} onChange={e=>setNextPassword(e.target.value)}/></label><button className="account-outline" disabled={accountBusy} onClick={()=>void updateAccountPassword()}><KeyRound size={15}/> Update password</button><button className="account-muted" disabled={accountBusy} onClick={()=>void signOutOtherDevices()}><RefreshCw size={14}/> Sign out other devices</button><button className="account-muted" onClick={()=>{setAccountOpen(false);void showWallet()}}><Zap size={14}/> View credit history</button></section></div>
      {accountFeedback&&<p className="account-feedback" role="status">{accountFeedback}</p>}
      <div className="account-footer"><span>Switching verifies each saved session with the server. Never share this browser on a public computer.</span><button onClick={logoutCurrent}><LogOut size={15}/> Sign out</button></div>
    </section></div>}
    {adminOpen && user?.isAdmin && <div className="modal-backdrop" onClick={()=>setAdminOpen(false)}><section className="admin-panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">VELQOZA OWNER CONTROL</span><h2>Admin dashboard</h2><p>Accounts, credits and projects — owner-only access</p></div><button className="icon-btn" onClick={()=>setAdminOpen(false)}><X/></button></div>
    <div className="admin-stats"><div><small>Accounts</small><strong>{adminData?.totals.accounts ?? '—'}</strong></div><div><small>Projects</small><strong>{adminData?.totals.projects ?? '—'}</strong></div><div><small>Outstanding Credits</small><strong>{adminData?.totals.outstandingCredits ?? '—'}</strong></div><div><small>Suspended</small><strong>{adminData?.totals.banned ?? '—'}</strong></div></div>
    <div className="admin-toolbar"><input placeholder="Find account by email" value={adminSearch} onChange={e=>setAdminSearch(e.target.value)}/><button className="studio-top-btn" onClick={()=>void loadAdmin()}>Refresh</button></div>
    {adminError && <p className="admin-error" role="alert">{adminError}</p>}<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Account</th><th>Projects</th><th>Credits</th><th>Status</th><th>Owner actions</th></tr></thead><tbody>{(adminData?.users||[]).filter(u=>u.email.toLowerCase().includes(adminSearch.toLowerCase())).map(u=><tr key={u.id}><td><strong>{u.email}</strong><small>{new Date(u.createdAt).toLocaleDateString()}</small></td><td>{u.projects}</td><td>{u.credits}</td><td>{u.isBanned?'Suspended':'Active'}</td><td><div className="admin-actions"><button disabled={adminBusy} onClick={()=>adjustCredits(u.id,u.email,1)}>+ Credits</button><button disabled={adminBusy} onClick={()=>adjustCredits(u.id,u.email,-1)}>− Credits</button>{u.id!==user.id && <><button disabled={adminBusy} onClick={()=>{if(window.confirm(`${u.isBanned?'Restore':'Suspend'} ${u.email}?`))void runAdmin(()=>api.adminBan(u.id,!u.isBanned))}}>{u.isBanned?'Unban':'Ban'}</button><button className="admin-danger" disabled={adminBusy} onClick={()=>{if(window.prompt(`Permanently delete ${u.email} and all projects? Type DELETE ACCOUNT`) !== 'DELETE ACCOUNT')return;void runAdmin(()=>api.adminDelete(u.id))}}>Delete</button></>}</div></td></tr>)}</tbody></table></div>
    <div className="admin-audit"><h3>Recent owner actions</h3>{adminAudit.length===0?<p>No actions yet.</p>:adminAudit.slice(0,15).map((a,i)=><p key={i}><strong>{a.action}</strong> · {new Date(a.createdAt).toLocaleString()} · {a.detail}</p>)}</div></section></div>}
    {walletOpen && <div className="modal-backdrop" onClick={()=>setWalletOpen(false)}><div className="projects-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">VELQOZA WALLET</span><h2>{walletInfo?.balance ?? '—'} Credits</h2></div><button className="icon-btn" onClick={()=>setWalletOpen(false)}><X/></button></div><p>Credits power your AI builds and edits. Online checkout is not available yet; prepaid codes can be redeemed here after you receive one from VELQOZA support.</p>
    <div className="voucher-box"><label htmlFor="voucher-code">Redeem prepaid code</label><div className="voucher-row"><input id="voucher-code" value={voucherCode} onChange={e=>setVoucherCode(e.target.value)} placeholder="VQ-..." autoComplete="off" maxLength={100}/><button disabled={voucherBusy||!voucherCode.trim()} onClick={redeemCode}>{voucherBusy?'Checking...':'Redeem'}</button></div>{voucherFeedback && <p role="status" className="voucher-feedback">{voucherFeedback}</p>}<small>Never send your password or API keys to purchase credits. A code works only once.</small></div><div className="credit-packages">{walletInfo?.packages.map(p=><div key={p.id} className="credit-package"><strong>{p.label}</strong><span>{p.credits} Credits</span><b>${(p.usdCents/100).toFixed(0)}</b><small>Coming soon · no payment taken</small></div>)}</div><p className="credit-prices">AI charges: Generate {walletInfo?.costs.generate ?? '—'} · Edit {walletInfo?.costs.edit ?? '—'} · Chat {walletInfo?.costs.studio ?? '—'} Credits. Prices are provisional.</p>
    <div className="wallet-history"><div className="wallet-history-head"><strong>Recent activity</strong><button type="button" onClick={()=>void refreshWallet()} title="Refresh balance and activity"><RotateCcw size={14}/> Refresh</button></div>
    {walletInfo?.ledger?.length ? <div className="wallet-ledger" role="list">{walletInfo.ledger.slice(0,12).map(entry=><div className="wallet-ledger-row" role="listitem" key={entry.id}><div><strong>{entry.kind === 'voucher'?'Prepaid credit code':entry.kind === 'refund'?'Refund':entry.kind === 'generate'?'Website generation':entry.kind === 'edit'?'Website edit':entry.kind === 'studio'?'AI Studio chat':entry.kind}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></div><b className={entry.delta >= 0?'wallet-ledger-positive':'wallet-ledger-negative'}>{entry.delta >= 0?'+':''}{entry.delta}</b></div>)}</div> : <p className="wallet-history-empty">No credit activity yet. Your transactions will appear here.</p>}</div>
    </div></div>}
    {mediaOpen && <div className="modal-backdrop" onClick={()=>setMediaOpen(false)}>
      <div className="projects-modal" role="dialog" aria-modal="true" aria-label="Project media library" onClick={e=>e.stopPropagation()} style={{maxHeight:'85vh',overflowY:'auto'}}>
        <div className="modal-head"><div><span className="section-kicker">MEDIA LIBRARY</span><h2>Images, audio & video</h2></div><button className="icon-btn" onClick={()=>setMediaOpen(false)} aria-label="Close media"><X/></button></div>
        <p style={{fontSize:13,lineHeight:1.65}}>Upload media once, then reference its URL from website HTML, CSS or the AI editor. Up to 20 files (30 MB total), maximum 3 MB each. Links are publicly accessible if shared: don't upload private files. Video must be a short compressed clip.</p>
        <label className="download-btn" style={{display:'inline-flex',cursor:mediaBusy?'wait':'pointer',marginTop:12,alignItems:'center',gap:8}}>
          <Plus size={15}/> {mediaBusy?'Uploading...':'Upload media'}
          <input type="file" hidden disabled={mediaBusy} accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,video/mp4,video/webm" onChange={e=>{void uploadMediaFile(e.target.files?.[0]);e.target.value=''}}/>
        </label>
        {mediaError && <p role="alert" style={{color:'#f4a7a7',marginTop:10}}>{mediaError}</p>}
        <div style={{display:'grid',gap:12,marginTop:16}}>
        {mediaAssets.length===0 && <p style={{opacity:.75}}>No media uploaded yet.</p>}
        {mediaAssets.map(asset=><div key={asset.id} style={{border:'1px solid rgba(255,255,255,.14)',borderRadius:12,padding:12,display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
          {asset.mime.startsWith('image/')?<img src={asset.url} alt={asset.name} style={{width:84,height:66,objectFit:'cover',borderRadius:7}}/>:asset.mime.startsWith('audio/')?<audio controls preload="none" src={asset.url} style={{width:160,maxWidth:'100%'}}/>:<video controls preload="metadata" src={asset.url} style={{width:150,maxWidth:'100%',height:90}}/>}
          <div style={{flex:1,minWidth:130,overflowWrap:'anywhere'}}><strong>{asset.name}</strong><div style={{fontSize:12,opacity:.75}}>{(asset.size/1024).toFixed(0)} KB · {asset.mime}</div></div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <button className="outline-btn" onClick={()=>{void navigator.clipboard.writeText(window.location.origin+asset.url);flash('Media URL copied.')}}><Copy size={13}/> URL</button>
            <button className="outline-btn" onClick={()=>{setChat(text=>text+(text?'\n':'')+'Use the uploaded '+asset.mime+' file at '+asset.url+' in this website. Keep the other pages and functionality intact.');setMediaOpen(false);setTab('editor')}}><WandSparkles size={13}/> Use with AI</button>
            <button className="outline-btn" disabled={mediaBusy} onClick={()=>void removeMediaAsset(asset.id)}><Trash2 size={13}/></button>
          </div>
        </div>)}
        </div>
      </div>
    </div>}
    {publishOpen && code && <div className="modal-backdrop" onClick={()=>setPublishOpen(false)}>
      <div className="projects-modal" role="dialog" aria-modal="true" aria-label="Publish website" onClick={e=>e.stopPropagation()}>
        <div className="modal-head"><div><span className="section-kicker">DIRECT PUBLISH</span><h2>Publish {code.title}</h2></div><button className="icon-btn" onClick={()=>setPublishOpen(false)} aria-label="Close publishing"><X/></button></div>
        <p style={{lineHeight:1.7}}>Publish directly from VELQOZA AI. Your website gets a public link hosted on this staging service. No ZIP or external hosting steps.</p>
        {publishedUrl && <div style={{padding:14,background:'rgba(40,180,120,.09)',borderRadius:12,margin:'12px 0',overflowWrap:'anywhere'}}>
          <strong>Live public website</strong>
          <div style={{marginTop:8}}><a href={publishedUrl} target="_blank" rel="noopener noreferrer">{window.location.origin+publishedUrl}</a></div>
          <button className="outline-btn" style={{marginTop:10}} onClick={()=>{void navigator.clipboard.writeText(window.location.origin+publishedUrl);flash('Public URL copied.')}}><Copy size={14}/> Copy public link</button>
        </div>}
        <div style={{padding:14,margin:'16px 0',border:'1px solid rgba(255,255,255,.14)',borderRadius:12}}>
          <strong>Choose your site name</strong>
          <p style={{fontSize:12,opacity:.8,marginTop:7}}>Reserve a unique name. The future branded address will look like onyx.velqoza.com, after separate DNS and TLS setup.</p>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
            <input aria-label="Website subdomain name" value={siteNameInput} maxLength={40}
              onChange={e=>{setSiteNameInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''));setNameAvailability('unknown');setNameReason('')}}
              placeholder="onyx" style={{minWidth:120,flex:1,background:"#171324",color:"#f7f3ff",caretColor:"#b59bff",border:"1px solid #6d5a8f",borderRadius:8,padding:"10px 12px",fontSize:15,outlineOffset:2}}/>
            <button className="outline-btn" disabled={nameAvailability==='checking'} onClick={()=>void checkPublicationName()}>Check name</button>
          </div>
          <p style={{fontSize:13,marginTop:8,overflowWrap:'anywhere'}}><strong>{siteNameInput||'your-site'}.velqoza.com</strong> <span style={{fontSize:11,opacity:.75}}>planned; not live yet</span></p>
          <p role="status" style={{fontSize:12,marginTop:7,color:nameAvailability==='taken'?'#f3a5a5':'inherit'}}>
            {nameAvailability==='available'?'✓ Name available for your account':nameAvailability==='taken'?nameReason:nameAvailability==='checking'?'Checking availability...':'Click Check name before publishing.'}
          </p>
          <p style={{fontSize:12,opacity:.8,marginTop:8}}>Working preview link after publishing: {window.location.origin}/sites/{siteNameInput||'your-site'}/</p>
        </div>
        <fieldset style={{border:'1px solid rgba(255,255,255,.14)',borderRadius:12,padding:14,margin:'16px 0'}}>
          <legend style={{padding:'0 6px',fontWeight:700}}>Domain options</legend>
          <div style={{display:'grid',gap:10}}>
            <label style={{display:'flex',gap:9,alignItems:'center',cursor:'pointer'}}><input type="radio" name="publish-domain" checked={publishDomainMode==='temporary'} onChange={()=>setPublishDomainMode('temporary')}/> Free VELQOZA staging link (available now)</label>
            <label style={{display:'flex',gap:9,alignItems:'center',cursor:'pointer'}}><input type="radio" name="publish-domain" checked={publishDomainMode==='existing'} onChange={()=>setPublishDomainMode('existing')}/> I already own a domain (coming later)</label>
            <label style={{display:'flex',gap:9,alignItems:'center',cursor:'pointer'}}><input type="radio" name="publish-domain" checked={publishDomainMode==='buy'} onChange={()=>setPublishDomainMode('buy')}/> Buy a new domain (coming later)</label>
          </div>
          {publishDomainMode==='existing' && <div style={{marginTop:12}}><label style={{display:'grid',gap:6}}>Domain for future setup<input type="text" value={publishDomain} onChange={e=>setPublishDomain(e.target.value)} placeholder="example.com" style={{background:"#171324",color:"#f7f3ff",caretColor:"#b59bff",border:"1px solid #6d5a8f",borderRadius:8,padding:"10px 12px",fontSize:15}}/></label><p style={{fontSize:12,marginTop:8}}>Custom domain DNS and ownership verification aren't integrated yet. Publishing will use the staging link, not this domain.</p></div>}
          {publishDomainMode==='buy' && <p style={{fontSize:12,marginTop:12}}>Domain search and payments aren't integrated yet. Publishing uses the staging link. No domain purchase is performed.</p>}
        </fieldset>
        <div style={{padding:14,margin:'14px 0',border:'1px solid rgba(255,255,255,.14)',borderRadius:12}}>
          <strong><ShieldCheck size={16} style={{verticalAlign:'middle',marginRight:6}}/> Public website warning</strong>
          <p style={{marginTop:8,lineHeight:1.6}}>Anyone with the link can view this site. Only static frontend HTML, CSS and JavaScript are hosted. Database, login, orders, payments, and extra backend files are NOT deployed. Remove private data and test everything before sharing. Publishing a demo does not activate its disabled functionality.</p>
        </div>
        <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer',lineHeight:1.5}}>
          <input type="checkbox" checked={publishApproved} onChange={e=>setPublishApproved(e.target.checked)} style={{marginTop:4}}/>
          <span>I have reviewed the site and agree to make this frontend website public.</span>
        </label>
        {publishError && <p role="alert" style={{color:'#f5a6a6',marginTop:12}}>{publishError}</p>}
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:18}}>
          <button className="download-btn" disabled={!publishApproved||publishing||nameAvailability!=='available'} onClick={()=>void publishNow()}>{publishing?<LoaderCircle className="spin" size={15}/>:<Rocket size={15}/>} {publishing?'Publishing...':publishedUrl?'Update published website':'Publish now'}</button>
          {publishedUrl && <button className="outline-btn" disabled={publishing} onClick={()=>void unpublishNow()}><X size={15}/> Unpublish</button>}
        </div>
      </div>
    </div>}
    {showProjects && <div className="modal-backdrop" onClick={()=>setShowProjects(false)}><div className="projects-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">YOUR WORKSPACE</span><h2>My projects</h2></div><button className="icon-btn" onClick={()=>setShowProjects(false)}><X/></button></div>{projects.length===0?<div className="empty-projects"><FolderOpen size={28}/><strong>No saved projects yet</strong><p>Generate a website and save it to see it here.</p></div>:<div className="project-list">{projects.map(p=><div className="project-row" key={p.id}><button className="project-open" onClick={()=>openProject(p)}><span className="project-thumb"><Globe2/></span><span><strong>{p.name}</strong><small>Updated {new Date(p.updatedAt).toLocaleDateString()}</small></span></button><div className="project-row-actions">{renameId===p.id?<><input value={renameValue} onChange={e=>setRenameValue(e.target.value)} onKeyDown={e=>e.key==='Enter'&&renameProject(p.id)}/><button onClick={()=>renameProject(p.id)}><Check size={15}/></button></>:<button title="Rename" onClick={()=>{setRenameId(p.id);setRenameValue(p.name)}}><Pencil size={15}/></button>}<button title="Delete" onClick={()=>deleteProject(p.id)}><Trash2 size={15}/></button></div></div>)}</div>}<button className="new-project-btn" onClick={()=>{if(changed && !window.confirm('Unsaved changes. Create new website?'))return;setShowProjects(false);setTab('builder');setCode(null);setPrompt('')}}><Plus size={16}/> Create a new website</button></div></div>}
    {authOpen && <div className="modal-backdrop" onClick={()=>setAuthOpen(false)}><form className="auth-modal" onSubmit={authSubmit} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close icon-btn" onClick={()=>setAuthOpen(false)}><X/></button><div className="auth-brand"><span className="brand-mark"><Sparkles/></span></div><span className="section-kicker">SECURE ACCOUNT</span><h2>{authMode==='signup'?'Create your account':authMode==='forgot'?'Reset your password':authMode==='reset'?'Choose a new password':'Log in to VELQOZA'}</h2><p>{authMode==='signup'?'Verify your email to activate your account and use Credits.':authMode==='forgot'?'We will email a secure reset link if the account exists.':authMode==='reset'?'Choose a strong password (8+ characters).':'Sign in to manage your projects and Credits.'}</p>{authMode!=='reset'&&<label>Email address<input type="email" required value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="you@example.com"/></label>}{authMode!=='forgot'&&<label>{authMode==='reset'?'New password':'Password'}<input type="password" required minLength={8} value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="At least 8 characters"/></label>}<button className="generate-btn auth-submit" disabled={busy}>{busy?<LoaderCircle className="spin"/>:authMode==='signup'?'Create account & verify email':authMode==='forgot'?'Send reset link':authMode==='reset'?'Set new password':'Log in'} <ArrowRight size={16}/></button><div className="auth-switch">{authMode==='login'?<>New to VELQOZA? <button type="button" onClick={()=>setAuthMode('signup')}>Create account</button><button type="button" onClick={()=>setAuthMode('forgot')}>Forgot password?</button><button type="button" disabled={busy} onClick={()=>void resendVerification()}>Resend verification</button></>:<>Already have an account? <button type="button" onClick={()=>setAuthMode('login')}>Log in</button></>}</div></form></div>}
  </div>
}

function Feature({icon,number,title,text}:{icon:React.ReactNode;number:string;title:string;text:string}) { return <article className="feature-card"><div className="feature-top"><span className="feature-icon">{icon}</span><span>{number}</span></div><h3>{title}</h3><p>{text}</p></article> }
function Step({n,title,text}:{n:string;title:string;text:string}) { return <article className="step"><span>{n}</span><div><h3>{title}</h3><p>{text}</p></div></article> }
function slug(s:string) { return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'website' }


// Small, dependency-free chat renderer. Text is escaped by React; code blocks
// are shown as literal text, never evaluated or inserted as HTML.
function StudioContent({content,onCopy}:{content:string;onCopy:()=>void}) {
  const parts = content.split(/(```[a-zA-Z0-9_+.#-]*\n[\s\S]*?```)/g)
  return <>{parts.map((part,i)=>{
    const match = part.match(/^```([a-zA-Z0-9_+.#-]*)\n([\s\S]*?)```$/)
    if (!match) {
      // Render cited source links as actual clickable URLs without enabling raw
      // HTML injection from model output or conversation history.
      const pieces=part.split(/(\[[^\]]{1,100}\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g)
      return <div className="studio-prose" key={i} dir="auto">{pieces.map((piece,j)=>{
        const md=piece.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
        const direct=/^https?:\/\/[^\s<]+$/.test(piece)
        const href=md?.[2]||(direct?piece:'')
        if(!href)return piece
        try {const url=new URL(href);if(!['http:','https:'].includes(url.protocol))return piece}
        catch{return piece}
        return <a key={j} href={href} rel="noopener noreferrer nofollow" target="_blank" style={{color:'#c5a6ff',textDecoration:'underline',overflowWrap:'anywhere'}}>{md?.[1]||piece}</a>
      })}</div>
    }
    return <div className="studio-code-block" key={i}><div className="studio-code-head"><span>{match[1] || 'code'}</span><button onClick={()=>{navigator.clipboard.writeText(match[2]);onCopy()}}><Copy size={12}/> Copy code</button></div><pre><code>{match[2]}</code></pre></div>
  })}</>
}
