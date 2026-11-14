/**
 * VELQOZA AI staging-Postgres -> isolated Supabase schema migration.
 *
 * DRY RUN (default):
 *   DATABASE_URL=... SUPABASE_DATABASE_URL=... SUPABASE_CA_CERT=... npm run migrate:supabase
 *
 * Apply ONLY with source writes paused and an independent verified backup:
 *   VELQOZA_MIGRATION_APPROVED=TRANSFER_EMPTY_TARGET -- npm run migrate:supabase -- --apply
 *
 * Runs on a trusted backend/runner with both URLs configured as environment secrets.
 * NEVER paste the URLs into command-line arguments or commit secrets to GitHub.
 * No DROP, TRUNCATE, DELETE, UPSERT, or schema-changing SQL.
 */
import pg from 'pg'

const tableOrder = [
  'users','projects','ai_threads','ai_thread_messages','ai_usage',
  'credit_wallets','credit_ledger','credit_vouchers','admin_audit',
  'email_auth_tokens','published_sites','published_site_names','media_assets',
  'studio_memories','ai_window_usage','package_requests','usage_quotas',
  'package_payments','quota_reservations','payment_webhook_events'
] as const

const {Client}=pg
const apply=process.argv.includes('--apply')
const sourceRaw=process.env.DATABASE_URL?.trim()
const targetRaw=process.env.SUPABASE_DATABASE_URL?.trim()
const ca=process.env.SUPABASE_CA_CERT?.replace(/\\n/g,'\n').trim()

function requireConnection() {
  if(!sourceRaw || !targetRaw)throw Error('DATABASE_URL and SUPABASE_DATABASE_URL must be provided securely.')
  const source=new URL(sourceRaw),target=new URL(targetRaw)
  if(!['postgres:','postgresql:'].includes(source.protocol)||!['postgres:','postgresql:'].includes(target.protocol))throw Error('Both URLs must use PostgreSQL.')
  if(!/^dpg-[a-z0-9-]+$/.test(source.hostname))throw Error('Source must be the private Render Postgres hostname.')
  if(!target.hostname.endsWith('.pooler.supabase.com')||target.port!=='5432')throw Error('Target must be Supabase Session pooler on port 5432.')
  if(!target.username.startsWith('postgres.'))throw Error('Unexpected target PostgreSQL user.')
  if(!ca?.includes('-----BEGIN CERTIFICATE-----')||!ca.includes('-----END CERTIFICATE-----'))throw Error('Supabase verified TLS CA is required.')
  if(source.href===target.href)throw Error('Source and target must differ.')
  target.searchParams.delete('sslmode')
  return {source:sourceRaw,target:target.toString()}
}

async function tableColumns(client:InstanceType<typeof Client>,table:string):Promise<string[]> {
  const {rows}=await client.query<{column_name:string}>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='velqoza_ai' AND table_name=$1
    ORDER BY ordinal_position`,[table])
  return rows.map(x=>x.column_name)
}
async function tableCount(client:InstanceType<typeof Client>,table:string):Promise<number> {
  const {rows}=await client.query<{n:string}>(`SELECT COUNT(*)::text AS n FROM velqoza_ai."${table}"`)
  return Number(rows[0]?.n??0)
}
async function main(){
  const urls=requireConnection()
  if(apply && process.env.VELQOZA_MIGRATION_APPROVED!=='TRANSFER_EMPTY_TARGET')
    throw Error('Apply requires VELQOZA_MIGRATION_APPROVED=TRANSFER_EMPTY_TARGET and an independently verified backup.')
  const source=new Client({connectionString:urls.source,ssl:false,application_name:'velqoza-migrate-read-source'})
  const target=new Client({connectionString:urls.target,ssl:{ca,rejectUnauthorized:true},application_name:'velqoza-migrate-target'})
  await source.connect()
  try{
    await target.connect()
    try{
      // SHARE locks in apply mode hold source rows stable until target transaction commits.
      await source.query(apply?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      await target.query('BEGIN')
      if(apply)await source.query(`LOCK TABLE ${tableOrder.map(t=>`velqoza_ai."${t}"`).join(', ')} IN SHARE MODE`)
      let total=0
      const plan:Array<{table:string;source:number;target:number}>=[]
      for(const table of tableOrder){
        const sourceCols=await tableColumns(source,table),targetCols=await tableColumns(target,table)
        if(!sourceCols.length||JSON.stringify(sourceCols)!==JSON.stringify(targetCols))
          throw Error('Table columns missing or different: '+table)
        const from=await tableCount(source,table),to=await tableCount(target,table)
        if(to!==0)throw Error('Target table is not empty: '+table+'. Aborting without changes.')
        plan.push({table,source:from,target:to})
        total+=from
      }
      if(total===0)throw Error('Source has no data to migrate; aborting.')
      console.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',totalRows:total,tables:plan},null,2))
      if(apply){
        for(const item of plan){
          if(item.source===0)continue
          const cols=await tableColumns(source,item.table)
          const names=cols.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',')
          const pageSize=Math.max(1,Math.min(50,Math.floor(2000/cols.length)))
          for(let offset=0;offset<item.source;offset+=pageSize){
            const {rows}=await source.query(`SELECT ${names} FROM velqoza_ai."${item.table}" ORDER BY 1 LIMIT $1 OFFSET $2`,[pageSize,offset])
            if(!rows.length)throw Error('Source changed during migration: '+item.table)
            const placeholders=rows.map((_,i)=>'('+cols.map((_,j)=>'$'+(i*cols.length+j+1)).join(',')+')').join(',')
            const params=rows.flatMap(row=>cols.map(col=>row[col]))
            await target.query(`INSERT INTO velqoza_ai."${item.table}" (${names}) VALUES ${placeholders}`,params)
          }
          const copied=await tableCount(target,item.table)
          if(copied!==item.source)throw Error('Row count mismatch after insert: '+item.table)
        }
        await target.query('COMMIT')
        console.log('COMPLETED: All 20 tables transferred with matching row counts. Verify application data before switching DATABASE_URL.')
      }else{
        await target.query('ROLLBACK')
        console.log('DRY RUN ONLY: No rows were written. Run apply only after backup and migration window are approved.')
      }
      await source.query('COMMIT')
    }catch(error){
      try{await target.query('ROLLBACK')}catch{}
      try{await source.query('ROLLBACK')}catch{}
      throw error
    }finally{await target.end()}
  }finally{await source.end()}
}
main().catch(err=>{console.error('Migration stopped safely:',err instanceof Error?err.message:'Unknown error');process.exitCode=1})
