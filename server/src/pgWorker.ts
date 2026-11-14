// A dedicated worker owns the sole PostgreSQL connection so the existing synchronous
// SQLite API can be migrated without changing its transaction boundaries.
import { parentPort, workerData } from 'node:worker_threads'
import pg from 'pg'
import { stagingSchemaSql } from './stagingSchema.js'

const { Client, types } = pg
types.setTypeParser(20, (v:string) => Number(v)) // COUNT(*) returns int8
// Render's same-region internal Postgres hostname uses a private network and a
// self-signed certificate. Do not force certificate verification there.
// Keep full TLS certificate verification for external/public database hosts.
const dbHost = new URL(workerData.connectionString).hostname
const renderPrivateHost = /^dpg-[a-z0-9-]+$/.test(dbHost)
const client = new Client({
  connectionString: workerData.connectionString,
  ssl: renderPrivateHost ? false : { rejectUnauthorized: true },
  application_name: 'velqoza-ai'
})
const port = workerData.port as import('node:worker_threads').MessagePort
let connected = false

function rewrite(sql: string): string {
  let result = sql.trim().replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO')
  const ignore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)
  result = result.replace(/\browid\b/ig, 'id')
  result = result.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*)\b/g, 'AS "$1"')
  let counter = 0
  // All server queries are static and use positional SQLite ? placeholders.
  result = result.replace(/\?/g, () => '$' + (++counter))
  if (ignore) result += ' ON CONFLICT DO NOTHING'
  return result
}
async function run(op: string, sql?: string, args?: unknown[]) {
  if (!connected) {
    await client.connect()
    if (process.env.STAGING_INIT_SCHEMA === 'true') {
      await client.query(stagingSchemaSql)
      console.log('[VELQOZA] Isolated staging PostgreSQL schema checked.')
    }
    await client.query('SET search_path TO velqoza_ai, pg_catalog')
    connected = true
  }
  if (op === 'begin') { await client.query('BEGIN'); return {} }
  if (op === 'commit') { await client.query('COMMIT'); return {} }
  if (op === 'rollback') { await client.query('ROLLBACK'); return {} }
  if (!sql) throw new Error('SQL missing')
  const result = await client.query(rewrite(sql), args ?? [])
  if (op === 'get') return result.rows[0] ?? null
  if (op === 'all') return result.rows
  if (op === 'run') return { changes:result.rowCount ?? 0 }
  throw new Error('Unknown operation')
}
// Serialize all messages, including BEGIN/COMMIT/ROLLBACK, on the single PG connection.
// An async event listener alone does not prevent requests from overlapping.
let queue: Promise<void> = Promise.resolve()
port.on('message', (msg: { op:string; sql?:string; args?:unknown[]; signal:SharedArrayBuffer }) => {
  queue = queue.then(async () => {
    const signal = new Int32Array(msg.signal)
    try {
      port.postMessage({ok:true,value:await run(msg.op,msg.sql,msg.args)})
    } catch (error) {
      // A failure inside an explicit transaction must be handled with rollback by caller.
      port.postMessage({ok:false,error:error instanceof Error ? error.message : 'Database error'})
    } finally {
      Atomics.store(signal,0,1)
      Atomics.notify(signal,0)
    }
  }).catch(error => {
    // Fatal queue errors must be surfaced rather than silently losing requests.
    console.error('[VELQOZA] PostgreSQL worker queue failed:',error)
  })
})
parentPort?.on('message', () => {})
