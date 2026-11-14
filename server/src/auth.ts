import jwt from 'jsonwebtoken'
import { db } from './db.js'
import type { NextFunction, Response } from 'express'
import type { AuthRequest } from './types.js'
const secret = () => {
  const value = process.env.JWT_SECRET
  if (!value || value.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters.')
  return value
}
export function signToken(userId: string) {
  const row = db.prepare('SELECT token_version FROM users WHERE id=?').get(userId) as {token_version:number}|undefined
  if (!row) throw new Error('Account not found')
  return jwt.sign({ sub: userId, tv: row.token_version }, secret(), { expiresIn: '30d', issuer: 'velqoza-ai' })
}
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Please log in to continue.' })
  try {
    const payload = jwt.verify(header.slice(7), secret(), { issuer: 'velqoza-ai' }) as jwt.JwtPayload
    if (typeof payload.sub !== 'string') throw new Error('Invalid token')
    const account = db.prepare('SELECT is_banned,email_verified,token_version FROM users WHERE id=?').get(payload.sub) as {is_banned:number;email_verified:number;token_version:number}|undefined
    if (!account) return res.status(401).json({error:'Account no longer exists.'})
    if ((payload.tv ?? 0) !== account.token_version) return res.status(401).json({error:'Your session has been revoked. Please log in again.'})
    if (account.is_banned) return res.status(403).json({error:'This account has been suspended. Contact VELQOZA support.'})
    if (!account.email_verified) return res.status(403).json({error:'Please verify your email address before continuing.'})
    req.userId = payload.sub
    next()
  } catch { return res.status(401).json({ error: 'Your session expired. Please log in again.' }) }
}
