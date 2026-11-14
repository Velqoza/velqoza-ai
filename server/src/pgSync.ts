// Low-concurrency compatibility adapter for the project's existing better-sqlite3 API.
// PostgreSQL connection secrets are only read on the backend. Never import in browser.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads'

export class PostgresDatabase {
  private worker: Worker
  private port: import('node:worker_threads').MessagePort
  private failed: Error | null = null
  private inTransaction = false

  constructor(connectionString:string) {
    if (!/^postgres(ql)?:\/\//.test(connectionString)) throw new Error('DATABASE_URL must be a PostgreSQL URL')
    const {port1,port2} = new MessageChannel()
    this.port=port1
    this.worker=new Worker(new URL('./pgWorker.js',import.meta.url),{workerData:{connectionString,port:port2},transferList:[port2]})
    this.worker.on('error', err => {this.failed=err})
    this.worker.on('exit', code => {this.failed=new Error(`Postgres worker stopped (${code})`)})
  }
  private request(op:string, sql?:string, args?:unknown[]):any {
    if (this.failed) throw this.failed
    const signal = new Int32Array(new SharedArrayBuffer(4))
    this.port.postMessage({op,sql,args,signal:signal.buffer})
    const deadline=Date.now()+30000
    let received
    while (!(received=receiveMessageOnPort(this.port))) {
      if (this.failed) throw this.failed
      if (Date.now() >= deadline) throw new Error('PostgreSQL operation timed out')
      Atomics.wait(signal,0,0,20)
    }
    if (!received.message.ok) throw new Error(received.message.error)
    return received.message.value
  }
  prepare(sql:string) {
    return {
      get:(...args:unknown[])=>this.request('get',sql,args) ?? undefined,
      all:(...args:unknown[])=>this.request('all',sql,args),
      run:(...args:unknown[])=>this.request('run',sql,args),
    }
  }
  transaction<T>(callback:()=>T) {
    const execute=()=>{
      if(this.inTransaction) throw new Error('Nested transactions are unsupported')
      this.request('begin');this.inTransaction=true
      try {
        const value=callback()
        this.request('commit')
        return value
      } catch(error) {
        try{this.request('rollback')} catch(rollbackError){this.failed=rollbackError as Error}
        throw error
      } finally {this.inTransaction=false}
    }
    return Object.assign(execute,{immediate:execute})
  }
}
