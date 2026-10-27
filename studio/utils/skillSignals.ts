/**
 * Overlap and quality signals for skills, as stored in `skillRelation` and
 * `skillQuality` documents.
 *
 * The numbers come from Jev (TypeSafe's decision model, served on OpenRouter's
 * Decisions endpoint), which answers typed questions with probabilities rather
 * than prose. Each pair is asked in both orders and averaged, which cancels the
 * small position bias measured in the spike (mean |Δ| 0.01 on `same_trigger`,
 * 89% of relationship labels identical).
 *
 * These are probabilities, so nothing here decides anything. `isNotableRelation`
 * only chooses which pairs are worth a document; what to do about a pair is a
 * person's call, recorded as an acknowledgement on the relation.
 */
import {getPublishedId} from './documentIds'
import {RULES_BY_ID, type DescriptionCheck} from './descriptionRules'

export const JEV_MODEL = 'typesafe/jev-1.13'

export const RELATIONSHIPS = [
  'duplicate',
  'overlapping_triggers',
  'supersedes',
  'complementary',
  'unrelated',
] as const
export type Relationship = (typeof RELATIONSHIPS)[number]

/** Relationships that mean the two skills compete for the same requests. */
const COMPETING: Relationship[] = ['duplicate', 'overlapping_triggers', 'supersedes']

export const ACTIONS = ['merge', 'extract_shared', 'clarify_boundary', 'keep'] as const
export type RecommendedAction = (typeof ACTIONS)[number]

// ---- Jev answer shapes (POST /api/alpha/decisions) ----------------------------

type NoulAnswer = {type: 'noul'; noul: number}
type ChoiceAnswer = {type: 'choice'; choice: string; probabilities?: Record<string, number>; confidence?: number}
type ScoreAnswer = {type: 'score'; score: number}

export type DescriptionPairAnswers = {
  same_trigger: NoulAnswer
  relationship: ChoiceAnswer
  overlap: ScoreAnswer
}

export type BodyPairAnswers = {
  contradicts: NoulAnswer
  duplicated_procedure: NoulAnswer
  action: ChoiceAnswer
}

// ---- Stored signal shapes ----------------------------------------------------

export type DescriptionSignal = {
  relationship: Relationship
  /** Averaged probability of the chosen relationship. */
  relationshipConfidence: number
  /** Probability mass on duplicate + overlapping_triggers + supersedes. */
  competing: number
  /** Probability that a request for one would just as likely load the other. */
  sameTrigger: number
  /** 0 no overlap · 1 same domain, distinct jobs · 2 partially overlapping triggers · 3 near-duplicates. */
  overlap: number
}

export type BodySignal = {
  contradicts: number
  duplicatedProcedure: number
  recommendedAction: RecommendedAction
  actionConfidence: number
}

export type RoutingSignal = {
  /** Trigger rows where the router put ≥0.1 on the wrong one of this pair. */
  confusedRows: number
  /** Total misplaced probability across those rows. */
  mass: number
  examples: string[]
}

export type RelationSignals = {
  description: DescriptionSignal
  body?: BodySignal
  routing?: RoutingSignal
}

// ---- Ids and hashes ----------------------------------------------------------

/** Sanity document ids are at most 128 characters. */
const MAX_ID_LENGTH = 128

/** Stable, synchronous 64-bit hash (two 32-bit FNV-1a passes), as hex. */
function pairHash(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * One `skillRelation` per pair of published skills, whichever order they come
 * in. Readable (`skillRelation.<idA>.<idB>`) when it fits; skills with long
 * ids get a hash of the pair instead.
 */
export function relationId(skillA: string, skillB: string): string {
  const [a, b] = [getPublishedId(skillA), getPublishedId(skillB)].sort()
  if (a === b) throw new Error(`relationId: cannot relate skill ${a} to itself`)
  const readable = `skillRelation.${a}.${b}`
  return readable.length <= MAX_ID_LENGTH ? readable : `skillRelation.pair-${pairHash(`${a}\n${b}`)}`
}

export function qualityId(skillId: string): string {
  return `skillQuality.${getPublishedId(skillId)}`
}

/**
 * Short SHA-256 of the text a result judged, so a stale result can say so.
 * Web Crypto, so the same function runs in the Studio, Functions and scripts.
 */
export async function textHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- Averaging ---------------------------------------------------------------

const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length

function averageProbabilities(answers: ChoiceAnswer[], options: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    options.map((option) => [option, mean(answers.map((a) => a.probabilities?.[option] ?? (a.choice === option ? 1 : 0)))]),
  )
}

function argmax<T extends string>(probabilities: Record<string, number>, options: readonly T[]): T {
  return options.reduce((best, option) => (probabilities[option] > probabilities[best] ? option : best), options[0])
}

export function averageDescriptionAnswers(answers: DescriptionPairAnswers[]): DescriptionSignal {
  if (answers.length === 0) throw new Error('averageDescriptionAnswers: no answers to average')
  const probabilities = averageProbabilities(answers.map((a) => a.relationship), RELATIONSHIPS)
  const relationship = argmax(probabilities, RELATIONSHIPS)
  return {
    relationship,
    relationshipConfidence: probabilities[relationship],
    competing: COMPETING.reduce((sum, r) => sum + probabilities[r], 0),
    sameTrigger: mean(answers.map((a) => a.same_trigger.noul)),
    overlap: mean(answers.map((a) => a.overlap.score)),
  }
}

export function averageBodyAnswers(answers: BodyPairAnswers[]): BodySignal {
  if (answers.length === 0) throw new Error('averageBodyAnswers: no answers to average')
  const probabilities = averageProbabilities(answers.map((a) => a.action), ACTIONS)
  const recommendedAction = argmax(probabilities, ACTIONS)
  return {
    contradicts: mean(answers.map((a) => a.contradicts.noul)),
    duplicatedProcedure: mean(answers.map((a) => a.duplicated_procedure.noul)),
    recommendedAction,
    actionConfidence: probabilities[recommendedAction],
  }
}

// ---- Selection and summary ---------------------------------------------------

/**
 * Whether a pair is worth a document. Of 7,626 pairs in the spike, two thirds
 * were plainly unrelated; storing those would bury the ones that matter.
 * Anything compared on bodies or confused by the router is kept regardless.
 */
export function isNotableRelation(signals: RelationSignals): boolean {
  if (signals.body || signals.routing) return true
  const d = signals.description
  return d.competing >= 0.2 || d.sameTrigger >= 0.25 || d.overlap >= 1.75
}

/**
 * Summaries are written for skill authors who may not know how skills get
 * picked, so they use words, not numbers. The numbers stay in the stored
 * fields for agents and tools that want them.
 */
const RELATIONSHIP_SENTENCE: Record<Relationship, (a: string, b: string) => string> = {
  duplicate: (a, b) => `${a} and ${b} look like the same skill.`,
  overlapping_triggers: (a, b) =>
    `${a} and ${b} do different jobs, but their descriptions cover some of the same requests, so the AI may pick the wrong one.`,
  supersedes: (a, b) => `One of ${a} and ${b} seems to cover everything the other does.`,
  complementary: (a, b) => `${a} and ${b} are related but do different jobs.`,
  unrelated: (a, b) => `${a} and ${b} are unrelated.`,
}

const SUGGESTION: Record<RecommendedAction, string | null> = {
  merge: 'Suggestion: combine them into one skill.',
  extract_shared: 'Suggestion: move the shared instructions into one reference file that both skills use.',
  clarify_boundary: 'Suggestion: make each description say what the skill is for, and which skill to use instead.',
  keep: null,
}

const times = (n: number) => (n === 1 ? 'once' : `${n} times`)

/** Plain-language summary for the Studio and for agents reading over MCP. */
export function summarizeRelation([nameA, nameB]: [string, string], signals: RelationSignals): string {
  const d = signals.description
  const parts = [RELATIONSHIP_SENTENCE[d.relationship](nameA, nameB)]
  const alreadySaysSo = d.relationship === 'duplicate' || d.relationship === 'overlapping_triggers'
  if (d.sameTrigger >= 0.5 && !alreadySaysSo) parts.push('A request meant for one could easily go to the other.')
  if (signals.body) {
    const b = signals.body
    if (b.contradicts >= 0.5) parts.push('Their instructions may disagree with each other.')
    if (b.duplicatedProcedure >= 0.5) parts.push('They repeat some of the same instructions.')
    const suggestion = SUGGESTION[b.recommendedAction]
    if (suggestion) parts.push(suggestion)
  }
  if (signals.routing && signals.routing.confusedRows > 0) {
    parts.push(`In test requests, the AI picked the wrong one of the two ${times(signals.routing.confusedRows)}.`)
  }
  return parts.join(' ')
}

// ---- Routing -----------------------------------------------------------------

/** The answer meaning "no skill should fire" in routing rows. */
export const NO_SKILL = 'none'

/** Order-independent key for a pair of skill names. */
export function pairKey(nameA: string, nameB: string): string {
  return [nameA, nameB].sort().join('|')
}

/** One trigger row after routing it over the library. */
export type RoutedRow = {
  prompt: string
  /** Skill the row belongs to. */
  owner: string
  /** Skill name that should fire, or `none`. */
  expected: string
  acceptable: string[]
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export type SkillRouting = {
  total: number
  correct: number
  misses: Array<{prompt: string; expected: string; chose: string; confidence: number}>
  /** Skill names that won this skill's rows, most often first. */
  losesTo: string[]
}

/** Probability below this on a wrong skill is noise, not confusion. */
const CONFUSION_FLOOR = 0.1
const MAX_EXAMPLES = 3

/**
 * Per-skill routing results and per-pair confusion from routed rows.
 *
 * A row counts for its owner and for its expected skill, since a near-miss row
 * owned by one skill tests the other. Pair confusion is the probability the
 * router put on a wrong skill when a specific one was expected; rows expecting
 * `none` feed per-skill misses but never a pair.
 */
export function summarizeRouting(rows: RoutedRow[]): {
  pairs: Map<string, RoutingSignal>
  skills: Map<string, SkillRouting>
} {
  const pairs = new Map<string, RoutingSignal>()
  const skills = new Map<string, SkillRouting>()
  const lostTo = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const correct = row.choice === row.expected || row.acceptable.includes(row.choice)

    for (const name of new Set([row.owner, row.expected].filter((n) => n !== NO_SKILL))) {
      const skill = skills.get(name) ?? {total: 0, correct: 0, misses: [], losesTo: []}
      skill.total++
      if (correct) skill.correct++
      else {
        skill.misses.push({prompt: row.prompt, expected: row.expected, chose: row.choice, confidence: row.confidence})
        const counts = lostTo.get(name) ?? new Map<string, number>()
        counts.set(row.choice, (counts.get(row.choice) ?? 0) + 1)
        lostTo.set(name, counts)
      }
      skills.set(name, skill)
    }

    if (row.expected === NO_SKILL) continue
    for (const [name, probability] of Object.entries(row.probabilities)) {
      if (name === row.expected || name === NO_SKILL || row.acceptable.includes(name)) continue
      if (probability < CONFUSION_FLOOR) continue
      const key = pairKey(row.expected, name)
      const pair = pairs.get(key) ?? {confusedRows: 0, mass: 0, examples: []}
      pair.confusedRows++
      pair.mass += probability
      if (pair.examples.length < MAX_EXAMPLES) pair.examples.push(row.prompt)
      pairs.set(key, pair)
    }
  }

  for (const [name, counts] of lostTo) {
    const skill = skills.get(name)
    if (skill) skill.losesTo = [...counts].sort((a, b) => b[1] - a[1]).map(([winner]) => winner)
  }
  return {pairs, skills}
}

/** Plain-language summary of a skill's own checks. */
export function summarizeQuality(name: string, checks?: DescriptionCheck[], routing?: SkillRouting): string {
  const parts: string[] = []
  if (checks?.length) {
    const failed = checks.filter((c) => !c.passed).map((c) => RULES_BY_ID.get(c.rule)?.message ?? c.title)
    parts.push(...(failed.length ? [`Description of ${name}:`, ...failed] : [`The description of ${name} passes every description check.`]))
  }
  if (routing && routing.total > 0) {
    const others = routing.losesTo.length ? ` The others went to ${routing.losesTo.slice(0, 3).join(', ')}.` : ''
    parts.push(`The AI picked ${name} for ${routing.correct} of ${routing.total} test requests.${others}`)
  }
  return parts.join(' ') || `${name} hasn\u2019t been compared with other skills yet.`
}

// ---- Document builders -------------------------------------------------------

/** A skill as a check saw it: the hashes are of the exact text judged. */
export type JudgedSkill = {_id: string; name: string; descriptionHash: string; bodyHash?: string}

type WeakRef = {_type: 'reference'; _ref: string; _weak: true}
const weakRef = (id: string): WeakRef => ({_type: 'reference', _ref: getPublishedId(id), _weak: true})

type Stamp = {model: string; checkedAt: string}

export type RelationDoc = {
  _id: string
  _type: 'skillRelation'
  skillA: WeakRef
  skillB: WeakRef
  summary: string
  description: DescriptionSignal & Stamp & {hashA: string; hashB: string}
  body?: BodySignal & Stamp & {hashA?: string; hashB?: string}
  routing?: RoutingSignal & Stamp
}

/**
 * The fields of a `skillRelation`, with skill A as the lower published id —
 * the order `relationId` uses — and each hash kept with its own skill.
 * `acknowledgement` is never part of it: that is a person's, and writers
 * `set` these fields on top of whatever is there.
 */
export function buildRelationDoc({
  a,
  b,
  signals,
  checkedAt,
  model = JEV_MODEL,
}: {
  a: JudgedSkill
  b: JudgedSkill
  signals: RelationSignals
  checkedAt: string
  model?: string
}): RelationDoc {
  const [first, second] = getPublishedId(a._id) < getPublishedId(b._id) ? [a, b] : [b, a]
  const stamp = {model, checkedAt}
  return {
    _id: relationId(a._id, b._id),
    _type: 'skillRelation',
    skillA: weakRef(first._id),
    skillB: weakRef(second._id),
    summary: summarizeRelation([first.name, second.name], signals),
    description: {...signals.description, ...stamp, hashA: first.descriptionHash, hashB: second.descriptionHash},
    ...(signals.body && {body: {...signals.body, ...stamp, hashA: first.bodyHash, hashB: second.bodyHash}}),
    ...(signals.routing && {routing: {...signals.routing, ...stamp}}),
  }
}

export type QualityDoc = {
  _id: string
  _type: 'skillQuality'
  skill: WeakRef
  summary: string
  /** Fingerprint of the content (instructions) this comparison saw. */
  bodyHash?: string
  lint?: Stamp & {descriptionHash: string; checks: Array<DescriptionCheck & {_key: string; _type: 'descriptionCheck'}>}
  routing?: Omit<SkillRouting, 'misses'> &
    Stamp & {
      descriptionHash: string
      misses: Array<SkillRouting['misses'][number] & {_key: string; _type: 'routingMiss'}>
    }
}

export function buildQualityDoc({
  skill,
  checks,
  routing,
  checkedAt,
  model = JEV_MODEL,
}: {
  skill: JudgedSkill
  checks?: DescriptionCheck[]
  routing?: SkillRouting
  checkedAt: string
  model?: string
}): QualityDoc {
  const stamp = {model, checkedAt, descriptionHash: skill.descriptionHash}
  return {
    _id: qualityId(skill._id),
    _type: 'skillQuality',
    skill: weakRef(skill._id),
    summary: summarizeQuality(skill.name, checks, routing),
    ...(skill.bodyHash && {bodyHash: skill.bodyHash}),
    ...(checks?.length && {
      lint: {...stamp, checks: checks.map((check) => ({...check, _key: check.rule, _type: 'descriptionCheck' as const}))},
    }),
    ...(routing && {
      routing: {
        ...routing,
        ...stamp,
        misses: routing.misses.map((miss, i) => ({...miss, _key: `miss${i}`, _type: 'routingMiss' as const})),
      },
    }),
  }
}
