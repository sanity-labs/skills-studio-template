/**
 * Shared AI provider registry + dispatch.
 *
 * One `generateText()` entrypoint that routes to Anthropic, OpenAI, or
 * Gemini based on the selected model. Uses direct `fetch` (no SDK
 * imports) to keep Studio bundle size small and retry logic uniform.
 *
 * Used by:
 *   - Skill Lab (eval runner): pick a model, run skill against test cases
 *   - Prose Pick: pick a model per condition, generate prose pairs
 *   - improveDescription document action: improve a skill's description
 *
 * To add a model: append to `MODELS` below. To add a new provider:
 * extend `Provider`, add a generator function, route it from
 * `generateText`.
 */

export type Provider = 'anthropic' | 'openai' | 'google'
export type ModelFamily = 'claude' | 'gpt' | 'gemini'

export interface ModelOption {
  /** Stable API id passed to the provider. */
  id: string
  /** Human label for the picker. */
  label: string
  /** For aggregate tallies / colour-coding. */
  family: ModelFamily
  /** Which provider key to look up + which endpoint to hit. */
  provider: Provider
}

/**
 * Models available across all tools. Order = picker order.
 * Keep families grouped; newest first within each family.
 */
export const MODELS: ModelOption[] = [
  // Anthropic
  // Claude Fable 5 (`claude-fable-5`) is deliberately absent: it is priced
  // above the Opus tier ($10/$50 per MTok vs $5/$25) and an eval run fires
  // dozens of calls. Add it here if a task actually needs it.
  {id: 'claude-opus-5', label: 'Claude Opus 5', family: 'claude', provider: 'anthropic'},
  {id: 'claude-sonnet-5', label: 'Claude Sonnet 5', family: 'claude', provider: 'anthropic'},
  {id: 'claude-opus-4-8', label: 'Claude Opus 4.8', family: 'claude', provider: 'anthropic'},
  {id: 'claude-sonnet-4-7', label: 'Claude Sonnet 4.7', family: 'claude', provider: 'anthropic'},
  {id: 'claude-opus-4-7', label: 'Claude Opus 4.7', family: 'claude', provider: 'anthropic'},
  {id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', family: 'claude', provider: 'anthropic'},
  {id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5', family: 'claude', provider: 'anthropic'},
  {id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', family: 'claude', provider: 'anthropic'},
  {id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', family: 'claude', provider: 'anthropic'},
  {id: 'claude-opus-4-20250514', label: 'Claude Opus 4', family: 'claude', provider: 'anthropic'},
  {id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', family: 'claude', provider: 'anthropic'},

  // OpenAI
  {id: 'gpt-5', label: 'GPT-5', family: 'gpt', provider: 'openai'},
  {id: 'gpt-5-mini', label: 'GPT-5 mini', family: 'gpt', provider: 'openai'},
  {id: 'gpt-4.1', label: 'GPT-4.1', family: 'gpt', provider: 'openai'},
  {id: 'gpt-4o', label: 'GPT-4o', family: 'gpt', provider: 'openai'},

  // Google
  {id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', family: 'gemini', provider: 'google'},
  {id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', family: 'gemini', provider: 'google'},
]

export type ModelId = (typeof MODELS)[number]['id']

export const DEFAULT_MODEL_ID: ModelId = 'claude-opus-5'

export function findModel(id: string): ModelOption | undefined {
  return MODELS.find((m) => m.id === id)
}

export function modelFamily(id: string): ModelFamily | undefined {
  return findModel(id)?.family
}

/**
 * Secrets shape used by tools. Each is optional; the dispatcher errors
 * with a friendly message if a key is missing for the requested provider.
 */
export interface AISecrets {
  anthropicKey?: string
  openaiKey?: string
  geminiKey?: string
  /** OpenRouter: Jev decisions today; one key that can also reach Claude, GPT and Gemini. */
  openrouterKey?: string
}

function secretsForProvider(secrets: AISecrets, provider: Provider): string {
  const key =
    provider === 'anthropic' ? secrets.anthropicKey :
    provider === 'openai' ? secrets.openaiKey :
    secrets.geminiKey
  if (!key) {
    const providerLabel =
      provider === 'anthropic' ? 'Anthropic' :
      provider === 'openai' ? 'OpenAI' :
      'Google (Gemini)'
    throw new Error(`Missing API key for ${providerLabel}. Add it in the AI Providers settings.`)
  }
  return key
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface GenerateOptions {
  model: string | ModelOption
  /** System prompt (instructions, role). Optional. */
  system?: string
  /** User message. The actual prompt. */
  user: string
  /** Defaults to 8192. */
  maxTokens?: number
  /** Secrets bag — pulled from `useSecrets('aiProviders')`. */
  secrets: AISecrets
}

/**
 * Generate text using the selected model. Routes to the right provider,
 * applies retry-with-exponential-backoff on transient errors, returns
 * the response text as a string.
 *
 * Throws on:
 *   - Missing API key for the requested provider
 *   - Non-retryable API errors (4xx other than 429)
 *   - Network failures after retry budget exhausted
 */
export async function generateText(opts: GenerateOptions): Promise<string> {
  const model = typeof opts.model === 'string' ? findModel(opts.model) : opts.model
  if (!model) {
    throw new Error(`Unknown model id: ${typeof opts.model === 'string' ? opts.model : '(object)'}`)
  }
  const apiKey = secretsForProvider(opts.secrets, model.provider)
  const maxTokens = opts.maxTokens ?? 8192

  switch (model.provider) {
    case 'anthropic':
      return generateAnthropic({apiKey, modelId: model.id, system: opts.system, user: opts.user, maxTokens})
    case 'openai':
      return generateOpenAI({apiKey, modelId: model.id, system: opts.system, user: opts.user, maxTokens})
    case 'google':
      return generateGemini({apiKey, modelId: model.id, system: opts.system, user: opts.user, maxTokens})
  }
}

interface ProviderCallArgs {
  apiKey: string
  modelId: string
  system?: string
  user: string
  maxTokens: number
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const msg = String(err)
      const isTransient = /429|5\d\d|overloaded|rate.?limit|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg)
      if (attempt < 5 && isTransient) {
        const backoffMs = 3000 * Math.pow(2, attempt - 1)
        // eslint-disable-next-line no-console
        console.warn(`${label}: transient error (${msg.slice(0, 120)}); retry ${attempt}/4 in ${backoffMs}ms`)
        await sleep(backoffMs)
        continue
      }
      throw lastError
    }
  }
  throw lastError ?? new Error(`${label}: unknown error`)
}

async function generateAnthropic(args: ProviderCallArgs): Promise<string> {
  return withRetry('Anthropic', async () => {
    const body: Record<string, unknown> = {
      model: args.modelId,
      max_tokens: args.maxTokens,
      messages: [{role: 'user', content: args.user}],
    }
    if (args.system) body.system = args.system
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}))
      const msg = errorBody.error?.message || res.statusText
      throw new Error(`${res.status}: ${msg}`)
    }
    const data = await res.json()
    const blocks = Array.isArray(data.content) ? data.content : []
    const text = blocks
      .filter((b: {type?: string}) => b.type === 'text')
      .map((b: {text?: string}) => b.text || '')
      .join('\n')

    // Newer Claude models think by default, and thinking is billed against
    // max_tokens. With a tight budget the turn can end before any text block is
    // produced — an empty string that silently scores as a wrong answer. Fail
    // loudly instead, and say what to change.
    if (!text.trim()) {
      const stop = data.stop_reason ?? 'unknown'
      throw new Error(
        `Anthropic returned no text (stop_reason: ${stop}). ` +
          `Raise max_tokens — it is currently ${args.maxTokens}, which reasoning models can exhaust before answering.`,
      )
    }
    return text
  })
}

async function generateOpenAI(args: ProviderCallArgs): Promise<string> {
  return withRetry('OpenAI', async () => {
    const messages: Array<{role: string; content: string}> = []
    if (args.system) messages.push({role: 'system', content: args.system})
    messages.push({role: 'user', content: args.user})
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.modelId,
        messages,
        max_completion_tokens: args.maxTokens,
      }),
    })
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}))
      const msg = errorBody.error?.message || res.statusText
      throw new Error(`${res.status}: ${msg}`)
    }
    const data = await res.json()
    const choice = data.choices?.[0]
    return choice?.message?.content || ''
  })
}

async function generateGemini(args: ProviderCallArgs): Promise<string> {
  return withRetry('Gemini', async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.modelId}:generateContent?key=${args.apiKey}`
    const body: Record<string, unknown> = {
      contents: [{role: 'user', parts: [{text: args.user}]}],
      generationConfig: {maxOutputTokens: args.maxTokens},
    }
    if (args.system) {
      body.systemInstruction = {parts: [{text: args.system}]}
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}))
      const msg = errorBody.error?.message || res.statusText
      throw new Error(`${res.status}: ${msg}`)
    }
    const data = await res.json()
    const cand = data.candidates?.[0]
    const parts = cand?.content?.parts || []
    return parts.map((p: {text?: string}) => p.text || '').join('\n')
  })
}
