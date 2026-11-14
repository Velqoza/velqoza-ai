// Production schema bootstrap. This is intentionally a manual CLI, NEVER run
// by the web server on startup or on ordinary CI deploy.
// Build first: npm run build
// Inspection: DATABASE_URL='...' node server/scripts/prepare-production-db.mjs
// Apply ONLY to a verified NEW, EMPTY production database, with backups ready:
// CONFIRM_NEW_PRODUCTION_DATABASE=YES DATABASE_URL='...' node server/scripts/prepare-production-db.mjs --apply
import pg from 'pg'
import { stagingSchemaSql } from '../dist/stagingSchema.js'

const isApply=process.argv.includes('--apply')
const urlRaw=process.env.DATABASE_URL
if(!urlRaw){
  console.error('DATABASE_URL is required. No changes were made.')
  process.exit(2)
}
let url
try{url=new URL(urlRaw)}catch{console.error('DATABASE_URL is invalid.');process.exit(2)}
if(!['postgres:','postgresql:'].includes(url.protocol)){
  console.error('A PostgreSQL DATABASE_URL is required.')
  process.exit(2)
}
const name=decodeURIComponent(url.pathname.replace(/^\//,''))
if(!/production|prod/i.test(name)||/staging|test|sandbox|dev/i.test(name)){
  console.error('Database name must identify production, never staging/test. Found an unsafe database name.')
  process.exit(2)
}
if(isApply && process.env.CONFIRM_NEW_PRODUCTION_DATABASE!=='YES'){
  console.error('To apply, explicitly set CONFIRM_NEW_PRODUCTION_DATABASE=YES after independently verifying a new, empty production database.')
  process.exit(2)
}
const privateRenderHost=/^dpg-[a-z0-9-]+$/.test(url.hostname)
const client=new pg.Client({connectionString:urlRaw,ssl:privateRenderHost?false:{rejectUnauthorized:true},application_name:'velqoza-production-bootstrap'})
try{
  await client.connect()
  const identity=await client.query('SELECT current_database() AS name, current_user AS username')
  if(identity.rows[0]?.name!==name)throw new Error('Connected database did not match the expected database name.')
  const existing=await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='velqoza_ai' ORDER BY table_name`)
  console.log(JSON.stringify({database:name,schemaTables:existing.rows.length,tableNames:existing.rows.map(r=>r.table_name),action:isApply?'bootstrap':'inspection-only'},null,2))
  if(!isApply){
    console.log('Read-only inspection complete. Nothing was created or modified.')
  }else{
    if(existing.rows.length>0)throw new Error('Refusing to initialize a nonempty application schema. Existing user records may be present.')
    await client.query('BEGIN')
    try{
      await client.query(stagingSchemaSql)
      await client.query('COMMIT')
    }catch(err){await client.query('ROLLBACK');throw err}
    const confirmed=await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='velqoza_ai'")
    if(Number(confirmed.rows[0]?.count)<15)throw new Error('Schema bootstrap returned too few tables; inspect before application startup.')
    console.log('Fresh production schema successfully initialized. No user records were copied or deleted.')
  }
}catch(error){
  console.error('Production database inspection/bootstrap failed:',error instanceof Error?error.message:'unknown error')
  process.exitCode=1
}finally{await client.end().catch(()=>{})}
