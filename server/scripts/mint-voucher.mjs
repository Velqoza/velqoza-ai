// Manual prepaid-code issuance after independently verifying payment.
// Example: DATABASE_PATH=/absolute/path/velqoza.sqlite node server/scripts/mint-voucher.mjs 100
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
const amount=Number(process.argv[2])
if(!Number.isSafeInteger(amount)||amount<1||amount>100000){console.error('Usage: node server/scripts/mint-voucher.mjs <credits 1..100000>');process.exit(1)}
if(!path.isAbsolute(process.env.DATABASE_PATH||'')){console.error('Set DATABASE_PATH to the ABSOLUTE path to your persistent SQLite database.');process.exit(1)}
const database=new Database(process.env.DATABASE_PATH,{fileMustExist:true})
try {
  const code='VQ-'+randomBytes(24).toString('base64url')
  const hash=createHash('sha256').update(code).digest('hex')
  const stamp=new Date().toISOString()
  const expiry=new Date(Date.now()+90*24*60*60*1000).toISOString()
  database.prepare('INSERT INTO credit_vouchers(id,code_hash,credits,created_at,expires_at) VALUES(?,?,?,?,?)')
    .run(randomUUID(),hash,amount,stamp,expiry)
  console.log(`Credits: ${amount}\nExpires: ${expiry}\nONE-TIME CODE: ${code}`)
  console.log('Give this code only to the intended paying customer. This code will NOT be shown again.')
} finally {database.close()}
