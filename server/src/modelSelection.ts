import { z } from 'zod'

/** Only server-approved model IDs can be selected by clients. */
export const aiModelField = z.enum(['default', 'gpt-6.1-sol', 'gpt-6-astra']).default('default')
export type AiModelChoice = z.infer<typeof aiModelField>

export const isAdvancedModel = (choice: AiModelChoice) => choice !== 'default'

export function advancedModelsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENAI_MODELS_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY)
}

export function modelCatalog(env: NodeJS.ProcessEnv = process.env) {
  const enabled = advancedModelsEnabled(env)
  return [
    { id: 'default', label: 'Standard AI', description: 'Current VELQOZA builder model', available: true },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', description: 'Fast and capable; paid API usage', available: enabled },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: 'Advanced; higher paid API usage', available: enabled }
  ] as const
}

export function resolveOpenAIModel(choice: AiModelChoice = 'default', env: NodeJS.ProcessEnv = process.env): string {
  if (choice === 'default') return env.OPENAI_MODEL || 'gpt-6.1-terra'
  if (!advancedModelsEnabled(env)) throw new Error('Selected OpenAI model is not enabled on this server.')
  return choice
}

const clamp = (raw: string | undefined, fallback: number) => {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 10000) : fallback
}

/**
 * Best-effort guard against accidentally expensive model usage.
 * Works per server instance; persistent, account-based billing limits are still
 * necessary before offering unlimited access or rolling out widely.
 */
export function makeAdvancedModelLimiter(env: NodeJS.ProcessEnv = process.env) {
  const globalLimit = clamp(env.OPENAI_DAILY_LIMIT, 20)
  const perIpLimit = clamp(env.OPENAI_PER_IP_DAILY_LIMIT, 5)
  let today = ''
  let globalUsed = 0
  const byIp = new Map<string, number>()
  const byUser = new Map<string, number>()
  return (choice: AiModelChoice, userId: string, ip = 'unknown', time = new Date()): { ok: boolean; reason?: string } => {
    if (!isAdvancedModel(choice)) return { ok: true }
    if (!advancedModelsEnabled(env)) return { ok: false, reason: 'Selected AI model is not enabled.' }
    const date = time.toISOString().slice(0, 10)
    if (date !== today) { today = date; globalUsed = 0; byIp.clear(); byUser.clear() }
    const identity = userId || 'unknown-user'
    const address = ip || 'unknown-ip'
    if (globalUsed >= globalLimit || (byIp.get(address) || 0) >= perIpLimit || (byUser.get(identity) || 0) >= perIpLimit) {
      return { ok: false, reason: 'Advanced model daily usage limit reached; choose Standard AI or try tomorrow.' }
    }
    globalUsed++
    byIp.set(address, (byIp.get(address) || 0) + 1)
    byUser.set(identity, (byUser.get(identity) || 0) + 1)
    return { ok: true }
  }
}
