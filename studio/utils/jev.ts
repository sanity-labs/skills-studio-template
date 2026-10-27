/**
 * Client for Jev on OpenRouter's Decisions endpoint, plus the questions the
 * overlap checks ask.
 *
 * Jev is not a chat model: it takes `state` (the context) and named, typed
 * `questions`, and returns a typed answer per question with probabilities —
 * `noul` (yes/no), `choice` (one of named options) or `score` (a position on an
 * ordered scale). Input tokens are billed (about $0.04 per million), output is
 * free. The endpoint is marked alpha, so the URL and shapes live here only.
 *
 * The question wording is the spike's, unchanged: its results are what the
 * stored thresholds were read from, so rewording a question means re-reading
 * them.
 */
import {JEV_MODEL, NO_SKILL} from './skillSignals'

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'

type Questions = Record<string, Record<string, unknown>>

export type DecideOptions = {
  apiKey: string
  state: unknown
  questions: Questions
  fetch?: typeof globalThis.fetch
  /** Base delay before a retry; doubles each attempt. */
  retryDelayMs?: number
}

export type Decision<A = Record<string, unknown>> = {answers: A; cost: number}

const RETRYABLE = new Set([429, 500, 502, 503, 524, 529])
const MAX_ATTEMPTS = 4

export async function decide<A = Record<string, unknown>>(options: DecideOptions): Promise<Decision<A>> {
  const {apiKey, state, questions, fetch = globalThis.fetch, retryDelayMs = 1000} = options
  if (!apiKey) throw new Error('Comparing skills needs an OpenRouter API key. Add one under API Keys.')

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(DECISIONS_URL, {
      method: 'POST',
      headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model: JEV_MODEL, state, questions}),
    })
    if (res.ok) {
      const json = await res.json()
      return {answers: json.answers as A, cost: json.usage?.cost ?? 0}
    }
    const reason = (await res.text()).slice(0, 300)
    if (!RETRYABLE.has(res.status) || attempt >= MAX_ATTEMPTS) {
      throw new Error(failureMessage(res.status, reason))
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** (attempt - 1)))
  }
}

/** What went wrong and what to do, for someone who has never heard of the service behind it. */
function failureMessage(status: number, reason: string): string {
  if (status === 401 || status === 403) return `Couldn\u2019t compare skills: the OpenRouter API key was rejected. Check the key under API Keys. (${status})`
  if (status === 402) return `Couldn\u2019t compare skills: the OpenRouter account is out of credit. Ask the person who manages it to top it up. (${status})`
  if (RETRYABLE.has(status)) return `Couldn\u2019t compare skills: the AI service is busy. Try again in a minute. (${status})`
  return `Couldn\u2019t compare skills: the AI service returned an error (${status}). ${reason}`
}

/** Run tasks with at most `limit` in flight. Results keep their input order. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({length: Math.min(limit, items.length)}, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await task(items[i])
      }
    }),
  )
  return results
}

// ---- State -------------------------------------------------------------------

export type SkillText = {skillName: string; title?: string; description: string; content?: string}

const brief = (s: SkillText, withBody: boolean) => ({
  name: s.skillName,
  title: s.title,
  description: s.description,
  ...(withBody && {body: s.content ?? ''}),
})

export function pairState(a: SkillText, b: SkillText, {withBody}: {withBody: boolean}) {
  return {skill_a: brief(a, withBody), skill_b: brief(b, withBody)}
}

// ---- Questions ---------------------------------------------------------------

export const DESCRIPTION_PAIR_QUESTIONS: Questions = {
  same_trigger: {
    type: 'noul',
    instructions:
      'An agent picks which skill to load from its description. Would a realistic user request that should load skill_a be just as likely to load skill_b?',
    criteria: {
      true: 'The descriptions claim the same requests; the agent could plausibly pick either.',
      false: 'A request for skill_a would clearly route to skill_a, not skill_b.',
    },
  },
  relationship: {
    type: 'choice',
    instructions: 'How do these two skills relate?',
    criteria: {
      duplicate: 'They do essentially the same job for the same people.',
      overlapping_triggers: 'Different jobs, but their trigger phrases or scope claim the same requests.',
      supersedes: 'One is a broader or newer version that covers the other.',
      complementary: 'Related domain; one feeds into or is used alongside the other, with clear boundaries.',
      unrelated: 'Different domains or jobs.',
    },
  },
  overlap: {
    type: 'score',
    instructions: 'How much do these skills overlap in when they should be loaded?',
    criteria: [
      'No overlap: different domains',
      'Same broad domain, distinct jobs',
      'Partially overlapping triggers',
      'Near-duplicates',
    ],
  },
}

export const BODY_PAIR_QUESTIONS: Questions = {
  contradicts: {
    type: 'noul',
    instructions:
      'Do skill_a and skill_b give conflicting instructions, definitions, rules, thresholds or procedures for the same thing (e.g. different definitions of a metric, different steps for the same task, different field names for the same data)?',
    criteria: {
      true: 'At least one concrete conflict: following one skill would violate the other.',
      false: 'No conflicts; they agree or cover different ground.',
    },
  },
  duplicated_procedure: {
    type: 'noul',
    instructions:
      'Does one skill copy a substantial workflow, query, data map, rubric or reference block that also appears in the other (same content, possibly reworded)?',
    criteria: {
      true: 'A substantial block of content is duplicated between them.',
      false: 'Only incidental overlap such as shared terminology or a passing mention.',
    },
  },
  action: {
    type: 'choice',
    instructions: 'What should the skill library owners do about this pair?',
    criteria: {
      merge: 'They do the same job; keep one skill.',
      extract_shared: 'Distinct jobs, but shared content should move into one reference both point to.',
      clarify_boundary: 'Distinct jobs, but the bodies blur into each other and need sharper scope.',
      keep: 'Clearly separate; no action needed.',
    },
  },
}

/** One `choice` over every skill's description, plus the no-skill answer. */
export function routingQuestions(library: Array<Pick<SkillText, 'skillName' | 'description'>>): Questions & {
  skill: {type: string; instructions: string; criteria: Record<string, string>}
} {
  const criteria: Record<string, string> = Object.fromEntries(library.map((s) => [s.skillName, s.description]))
  criteria[NO_SKILL] = 'No skill fits; the agent should answer directly without loading a skill.'
  return {
    skill: {
      type: 'choice',
      instructions:
        'The user sent the message in state to an agent. Which skill should the agent load to handle it? Pick none if no skill fits.',
      criteria,
    },
  }
}
