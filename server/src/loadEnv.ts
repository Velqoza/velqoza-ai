// Development launches from both the workspace root and server/. Load private settings
// from server/.env first; never read or expose secrets in the client bundle.
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true })
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true })
