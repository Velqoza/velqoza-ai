import pg from 'pg'

/**
 * Staging-only connectivity probe for an optional Supabase database URL.
 * Opens a completely separate connection and executes read-only metadata queries.
 * NEVER swaps the live DB connection, updates records or prints credentials.
 */
export async function probeSupabaseDatabase():Promise<void> {
  if (process.env.STAGING_INIT_SCHEMA !== 'true') return
  const raw=process.env.SUPABASE_DATABASE_URL?.trim()
  if(!raw){console.info('[Supabase probe] Not configured; active database unchanged.');return}
  let url:URL
  try { url=new URL(raw) } catch {
    console.warn('[Supabase probe] Invalid URI format; active database unchanged.')
    return
  }
  if(url.protocol!=='postgres:'&&url.protocol!=='postgresql:'){
    console.warn('[Supabase probe] Connection string is not PostgreSQL.')
    return
  }
  if(!url.hostname.endsWith('.pooler.supabase.com')||url.port!=='5432'){
    console.warn('[Supabase probe] Expected Supabase Session pooler on port 5432.')
    return
  }
  if(!url.username.startsWith('postgres.')){
    console.warn('[Supabase probe] Expected Supabase session-pooler database user.')
    return
  }
  if(!url.password||url.password.includes('YOUR-PASSWORD')){
    console.warn('[Supabase probe] Replace the password placeholder directly in Render Environment.')
    return
  }
  const ca=process.env.SUPABASE_CA_CERT?.replace(/\\n/g,'\n').trim()
  if(!ca||!ca.includes('-----BEGIN CERTIFICATE-----')||!ca.includes('-----END CERTIFICATE-----')){
    console.warn('[Supabase probe] CA certificate missing. Add SUPABASE_CA_CERT from the Supabase Database SSL settings.')
    return
  }
  // pg connection-string sslmode may override the trusted CA object. Explicitly
  // remove it and use Node TLS verification with Supabase's certificate.
  url.searchParams.delete('sslmode')
  const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:9000,query_timeout:9000,ssl:{ca,rejectUnauthorized:true},application_name:'velqoza-ai-supabase-probe'})
  try {
    await client.connect()
    const result=await client.query<{tables:number}>(`
      SELECT count(*)::int AS tables
      FROM information_schema.tables
      WHERE table_schema = 'velqoza_ai'
    `)
    const tables=Number(result.rows[0]?.tables??0)
    const required=await client.query<{users:string|null;projects:string|null;payments:string|null}>(`
      SELECT to_regclass('velqoza_ai.users')::text AS users,
             to_regclass('velqoza_ai.projects')::text AS projects,
             to_regclass('velqoza_ai.package_payments')::text AS payments
    `)
    const valid=tables>=20 && !!required.rows[0]?.users && !!required.rows[0]?.projects && !!required.rows[0]?.payments
    console.info(valid?'[Supabase probe] PASS — private AI schema and required tables are accessible (read-only).':
      '[Supabase probe] FAIL — connected but the private AI schema is incomplete.')
    // Migration preflight: read-only counts only. No row content, passwords or
    // connection string values are logged. Keep the original database active.
    const targetCounts=await client.query<{users:number;projects:number;payments:number}>(`
      SELECT (SELECT count(*)::int FROM velqoza_ai.users) AS users,
             (SELECT count(*)::int FROM velqoza_ai.projects) AS projects,
             (SELECT count(*)::int FROM velqoza_ai.package_payments) AS payments
    `)
    const origin=process.env.DATABASE_URL?.trim()
    if(origin){
      let originUrl:URL
      try{originUrl=new URL(origin)}catch{throw new Error('Invalid primary database URL.')}
      const privateHost=/^dpg-[a-z0-9-]+$/.test(originUrl.hostname)
      if(privateHost){
        const source=new pg.Client({connectionString:origin,ssl:false,connectionTimeoutMillis:9000,query_timeout:9000,
          application_name:'velqoza-ai-readonly-migration-preflight'})
        try{
          await source.connect()
          const sourceCounts=await source.query<{users:number;projects:number;payments:number}>(`
            SELECT (SELECT count(*)::int FROM velqoza_ai.users) AS users,
                   (SELECT count(*)::int FROM velqoza_ai.projects) AS projects,
                   (SELECT count(*)::int FROM velqoza_ai.package_payments) AS payments
          `)
          console.info('[Migration preflight] Read-only counts source='+JSON.stringify(sourceCounts.rows[0])+
            ' target='+JSON.stringify(targetCounts.rows[0])+'. No data moved.')
        }finally{await source.end().catch(()=>{})}
      }else console.info('[Migration preflight] Source is not a private Render endpoint; skipping counts.')
    }
  } catch(err) {
    const code=(err&&typeof err==='object'&&'code' in err&&typeof err.code==='string')?err.code:'connection-error'
    console.warn('[Supabase probe] Could not connect/read schema. Code: '+String(code).slice(0,24)+'; active database unchanged.')
  } finally {
    try{await client.end()}catch{}
  }
}
