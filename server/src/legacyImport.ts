import { timingSafeEqual } from 'node:crypto'
import type { Express } from 'express'
import type Database from 'better-sqlite3'

type RecordRow = Record<string, unknown>
const columns: Record<string, string[]> = {
  users:['id','email','password_hash','created_at','is_banned','email_verified','token_version','display_name'],
  projects:['id','user_id','name','code_json','created_at','updated_at'],
  ai_threads:['id','user_id','title','created_at','updated_at'],
  ai_thread_messages:['id','thread_id','role','content','created_at'],
  ai_usage:['user_id','day','kind','count'],
  credit_wallets:['user_id','balance'],
  credit_ledger:['id','user_id','delta','kind','reference_id','created_at'],
  credit_vouchers:['id','code_hash','credits','created_at','expires_at','redeemed_by','redeemed_at'],
  admin_audit:['id','admin_id','target_user_id','action','detail','created_at'],
  email_auth_tokens:['id','user_id','purpose','token_hash','expires_at','created_at']
}
const order = Object.keys(columns)

function permitted(secret: string | undefined, supplied: unknown) {
  if (!secret || typeof supplied !== 'string') return false
  const a = Buffer.from(secret), b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a,b)
}
export function installLegacyImporter(app: Express, db: Database.Database) {
  // Temporary, disabled unless an explicit staging-only secret is set.
  app.get('/internal/restore-legacy', (_req,res) => {
    res.setHeader('Cache-Control','no-store')
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VELQOZA private restore</title><style>body{background:#11121c;color:white;font:16px system-ui;max-width:620px;margin:10vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:14px;margin:10px 0;border-radius:9px}button{background:#8056f4;color:white;border:0;cursor:pointer}small{color:#bbb}</style><h2>VELQOZA AI — Private legacy restore</h2><p>Import only your private backup file. Existing staging accounts and projects are preserved. Do not upload the file to GitHub.</p><label>One-time import code<input id="secret" type="password" autocomplete="off"></label><label>Private backup JSON<input id="file" type="file" accept=".json,application/json"></label><button id="send">Import legacy data</button><pre id="status"></pre><small>Use only on velqoza-ai-staging.onrender.com.</small><script defer src="/internal/restore-legacy.js"></script></html>`)
  })
  app.get('/internal/restore-legacy.js', (_req,res) => {
    res.setHeader('Cache-Control','no-store')
    res.type('application/javascript').send("document.querySelector('#send').onclick=async()=>{const status=document.querySelector('#status');status.textContent='Importing...';try{const file=document.querySelector('#file').files[0];if(!file)throw Error('Choose the JSON file');const data=JSON.parse(await file.text());const response=await fetch('/api/internal/restore-legacy',{method:'POST',headers:{'Content-Type':'application/json','X-Legacy-Import-Token':document.querySelector('#secret').value},body:JSON.stringify(data)});status.textContent=JSON.stringify(await response.json(),null,2)}catch(e){status.textContent=String(e)}};")
  })
  app.post('/api/internal/restore-legacy', (req,res) => {
    if (process.env.NODE_ENV !== 'production' || !process.env.STAGING_INIT_SCHEMA || !permitted(process.env.LEGACY_IMPORT_TOKEN,req.header('X-Legacy-Import-Token'))) return res.status(404).json({error:'Not available'})
    const data = req.body as {format?:unknown;tables?:Record<string,unknown>}
    if (data?.format !== 'velqoza-legacy-v1' || !data.tables || typeof data.tables !== 'object') return res.status(400).json({error:'Invalid import file'})
    for (const table of order) if (!Array.isArray(data.tables[table]) || (data.tables[table] as unknown[]).length > 2000 || !(data.tables[table] as unknown[]).every(v => !!v && typeof v === 'object' && !Array.isArray(v))) return res.status(400).json({error:'Invalid rows'})
    if ((data.tables.projects as unknown[]).length > 100) return res.status(400).json({error:'Too many projects'})
    try {
      const result = db.transaction(() => {
        db.prepare('CREATE TABLE IF NOT EXISTS velqoza_ai.legacy_import_marks (id TEXT PRIMARY KEY, imported_at TEXT NOT NULL)').run()
        const mark = 'user-backup-2026-11-14'
        if (db.prepare('SELECT id FROM velqoza_ai.legacy_import_marks WHERE id=?').get(mark)) return {alreadyImported:true}
        const rows = data.tables as Record<string,RecordRow[]>
        const idMap = new Map<string,string>()
        for (const user of rows.users) {
          const email = String(user.email || '').trim().toLowerCase()
          if (!email || !user.id || !user.password_hash) throw Error('Invalid user data')
          const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email) as {id:string}|undefined
          if (existing) idMap.set(String(user.id),existing.id)
          else {
            const cols = columns.users
            const vals = cols.map(c=>user[c] ?? (c==='is_banned'||c==='token_version'?0:c==='email_verified'?1:c==='display_name'?'':null))
            db.prepare(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON CONFLICT DO NOTHING`).run(...vals)
            idMap.set(String(user.id),String(user.id))
          }
        }
        const counts:Record<string,number> = {users:rows.users.length}
        for (const table of order.slice(1)) {
          counts[table]=0
          for (const source of rows[table]) {
            const row = {...source}
            if (row.user_id != null) row.user_id = idMap.get(String(row.user_id)) || row.user_id
            if (row.redeemed_by != null) row.redeemed_by = idMap.get(String(row.redeemed_by)) || row.redeemed_by
            if (table==='credit_wallets') {
              const existing=db.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get(row.user_id) as {balance:number}|undefined
              if (existing) {
                db.prepare('UPDATE credit_wallets SET balance=? WHERE user_id=?').run(existing.balance + Number(row.balance || 0),row.user_id)
                counts[table]++
                continue
              }
            }
            if (table==='ai_usage') {
              // Do not import historical request counters into a new staging account.
              continue
            }
            if (table==='email_auth_tokens') continue // Never restore expired verification/reset links.
            const cols=columns[table]
            const vals=cols.map(c=>row[c] ?? null)
            const stmt=`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON CONFLICT DO NOTHING`
            const out=db.prepare(stmt).run(...vals)
            counts[table]+=out.changes
          }
        }
        db.prepare('INSERT INTO velqoza_ai.legacy_import_marks(id,imported_at) VALUES(?,?)').run(mark,new Date().toISOString())
        return {ok:true,counts}
      })()
      res.json(result)
    } catch(err) {
      console.error('[VELQOZA] Private legacy import failed:',err instanceof Error ? err.message:'unknown')
      res.status(500).json({error:'Restore failed; transaction rolled back. See staging logs.'})
    }
  })
}
