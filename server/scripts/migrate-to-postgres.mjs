// One-time, non-destructive migration. Stop the local app and back up the SQLite DB first.
// Usage from root: DATABASE_URL='postgresql://...' SQLITE_SOURCE='/absolute/path/velqoza.sqlite' npm run migrate:postgres --workspace server
// Writes only on explicit --execute. All inserts run inside a single PostgreSQL transaction.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import pg from 'pg'
import dotenv from 'dotenv'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
dotenv.config({path:path.join(root,'server/.env'),quiet:true})
const sqlitePath=path.resolve(process.env.SQLITE_SOURCE || path.join(root,'data/velqoza.sqlite'))
if(!fs.existsSync(sqlitePath)) throw new Error('SQLite source not found; set SQLITE_SOURCE to current, latest backup')
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const execute=process.argv.includes('--execute')
const sqlite=new Database(sqlitePath,{readonly:true,fileMustExist:true})
const tables=['users','projects','ai_threads','ai_thread_messages','ai_usage','credit_wallets','credit_ledger','credit_vouchers','admin_audit','email_auth_tokens']
const existing=new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name))
const columns={
 users:['id','email','password_hash','created_at','is_banned','email_verified','token_version','display_name'],
 projects:['id','user_id','name','code_json','created_at','updated_at'],
 ai_threads:['id','user_id','title','created_at','updated_at'],
 ai_thread_messages:['id','thread_id','role','content','created_at'],
 ai_usage:['user_id','day','kind','count'],
 credit_wallets:['user_id','balance'],
 credit_ledger:['id','user_id','delta','kind','reference_id','created_at'],
 credit_vouchers:['id','code_hash','credits','created_at','expires_at','redeemed_by','redeemed_at'],
 admin_audit:['id','admin_id','target_user_id','action','detail','created_at'],
 email_auth_tokens:['id','user_id','purpose','token_hash','expires_at','created_at'],
}
const defaults={is_banned:0,email_verified:1,token_version:0,display_name:''}
const snapshot={}
for(const table of tables){
 const rows=existing.has(table)?sqlite.prepare(`SELECT * FROM ${table}`).all():[]
 snapshot[table]=rows.map(row=>Object.fromEntries(columns[table].map(key=>[key,row[key]===undefined?(defaults[key]??null):row[key]])))
}
sqlite.close()
console.log('Source:',sqlitePath)
console.log('Table counts:',Object.fromEntries(tables.map(t=>[t,snapshot[t].length])))
if(!execute){console.log('DRY RUN ONLY. Pass --execute with the latest source SQLite snapshot to import.');process.exit(0)}
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}})
await client.connect()
try{
 await client.query('BEGIN')
 await client.query('SET LOCAL search_path TO velqoza_ai, pg_catalog')
 let insertedTotal=0
 for(const table of tables){
  const cols=columns[table]
  let inserted=0
  for(const row of snapshot[table]){
   const fields=cols.map(k=>row[k])
   const params=cols.map((_,i)=>'$'+(i+1)).join(',')
   const stmt=`INSERT INTO ${table} (${cols.join(',')}) VALUES (${params}) ON CONFLICT DO NOTHING`
   const result=await client.query(stmt,fields)
   inserted+=result.rowCount || 0
  }
  console.log(`${table}: ${inserted} imported, ${snapshot[table].length-inserted} already present`)
  insertedTotal+=inserted
 }
 await client.query('COMMIT')
 console.log(`COMMITTED ${insertedTotal} rows, without deleting or overwriting cloud records.`)
}catch(error){await client.query('ROLLBACK');throw error}finally{await client.end()}
