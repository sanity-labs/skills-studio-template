/**
 * What the stored comparison with other skills says about a skill as it is.
 *
 * Findings come in three levels, which validation shows as Sanity's three:
 *   hold → error, which disables Publish in the Studio
 *   warn → warning
 *   tip  → info
 * Holding is reserved for what needs a decision: an unacknowledged pair that
 * is a duplicate, or whose instructions say merge. Someone can allow
 * publishing with a reason, which covers that description only. Everything
 * else is a warning or a tip: these are probabilities, and a deliberate
 * difference (docs style vs marketing style) is not a defect.
 *
 * The comparison stores a snapshot of this on the skill (`metadata.comparison`)
 * and validation reads that; nothing here runs on a keystroke. Publishing over
 * MCP or the API skips Studio validation, so the sync is where distribution
 * is enforced (Stage 6).
 */
import type {SanityClient} from 'sanity'
import {qualityId} from './skillSignals'
import {getPublishedId} from './documentIds'
import {descriptionFixPrompt, pairFixPrompt, relationFix, type PairFix} from './fixPrompts'
import {RULES_BY_ID, type DescriptionCheck} from './descriptionRules'

export type StoredRelation = {
  _id: string
  skillA: {_ref: string}
  skillB: {_ref: string}
  /** Skill names, dereferenced when loaded; used to name the skills in fix prompts. */
  nameA?: string
  nameB?: string
  summary?: string
  description?: {relationship?: string; competing?: number; sameTrigger?: number; overlap?: number; hashA?: string; hashB?: string}
  body?: {contradicts?: number; duplicatedProcedure?: number; recommendedAction?: string; hashA?: string; hashB?: string}
  routing?: {confusedRows?: number}
  acknowledgement?: {reason?: string; by?: string; at?: string}
}

export type StoredOverride = {reason: string; descriptionHash: string; by?: string; at?: string}

export type StoredQuality = {
  lint?: {checks?: DescriptionCheck[]; descriptionHash?: string; checkedAt?: string}
  routing?: {total?: number; correct?: number; losesTo?: string[]; descriptionHash?: string}
  overrides?: StoredOverride[]
  /** Fingerprint of the content the last comparison saw. */
  bodyHash?: string
}

export type GateInput = {
  skillId: string
  skillName: string
  /** Hashes of the skill as it would be published now. */
  descriptionHash: string
  bodyHash: string
  quality: StoredQuality | null
  relations: StoredRelation[]
}

/**
 * One thing the comparison found, written for someone new to how skills get
 * picked: what was found, why it matters, and what to do. `fixPrompt` is set
 * when an edit can fix it: a prompt for an AI agent connected to the Sanity MCP.
 */
export type GateFinding = {
  /** hold: publishing is paused (validation error) · warn: warning · tip: a quiet note (validation info). */
  level: 'hold' | 'warn' | 'tip'
  /** The field the finding is about, where validation shows it. */
  field: 'description' | 'content'
  /** Which part of the results it belongs in. `freshness`: the results are out of date. */
  about: 'skill' | 'pair' | 'freshness'
  message: string
  why?: string
  todo?: string
  relationId?: string
  fixPrompt?: string
}
export type GateResult = {level: 'clear' | 'warn' | 'hold'; findings: GateFinding[]}

/** Name of the document action, as authors see it in the Publish menu. */
export const COMPARE_ACTION_LABEL = 'Compare with other skills'
const RUN_AGAIN = `Run \u201c${COMPARE_ACTION_LABEL}\u201d from the menu next to Publish.`
const PICKING = 'AI assistants decide which skill to use by reading skill descriptions.'

const PAIR_COPY: Record<PairFix, {message: (other: string) => string; why: string; todo: string; level: GateFinding['level']; field: GateFinding['field']}> = {
  merge: {
    message: (other) => `${other} looks like the same skill as this one.`,
    why: 'Two skills doing the same job make the AI pick between them at random, and the copies drift apart as each gets edited.',
    todo: 'Combine them into one skill. If both are needed, allow publishing and explain why.',
    level: 'hold',
    field: 'description',
  },
  contradict: {
    message: (other) => `This skill and ${other} may give different instructions for the same thing.`,
    why: 'People get different answers depending on which of the two skills the AI uses.',
    todo: 'Find where they disagree and make them match. If the difference is on purpose, say in each skill when its version applies.',
    level: 'warn',
    field: 'content',
  },
  extract: {
    message: (other) => `This skill and ${other} repeat some of the same instructions.`,
    why: 'When one copy is updated, the other falls behind.',
    todo: 'Move the shared instructions into one reference that both skills use.',
    level: 'tip',
    field: 'content',
  },
  clarify: {
    message: (other) => `This skill and ${other} cover some of the same requests.`,
    why: `${PICKING} When two descriptions overlap, the AI can pick the wrong skill.`,
    todo: 'Make each description say what the skill is for, and which skill to use instead.',
    level: 'warn',
    field: 'description',
  },
}

export function evaluateGate(input: GateInput): GateResult {
  const findings: GateFinding[] = []
  const self = getPublishedId(input.skillId)
  const {quality} = input
  const me = {id: self, name: input.skillName}

  // Freshness
  const checkedHash = quality?.lint?.descriptionHash ?? quality?.routing?.descriptionHash
  if (!checkedHash) {
    findings.push({
      level: 'warn',
      about: 'freshness',
      field: 'description',
      message: 'This skill hasn\u2019t been compared with other skills yet.',
      why: 'The comparison checks that the AI will pick this skill for the right requests, and that it doesn\u2019t repeat or contradict similar skills.',
      todo: RUN_AGAIN,
    })
  } else if (checkedHash !== input.descriptionHash) {
    findings.push({
      level: 'warn',
      about: 'freshness',
      field: 'description',
      message: 'The description changed since the last comparison with other skills.',
      why: `${PICKING} A new description can change which requests reach this skill.`,
      todo: RUN_AGAIN,
    })
  }

  // The skill on its own
  const failedChecks = (quality?.lint?.checks ?? []).filter((check) => !check.passed)
  const {total = 0, correct = 0, losesTo = []} = quality?.routing ?? {}
  const describeFix = descriptionFixPrompt({skill: me, failedRules: failedChecks.map((c) => c.rule), losesTo})
  for (const check of failedChecks) {
    const rule = RULES_BY_ID.get(check.rule)
    if (!rule) continue
    const sibling = losesTo[0]
    findings.push({
      level: rule.severity,
      about: 'skill',
      field: 'description',
      message: rule.message,
      why: rule.why,
      todo: rule.id === 'says_not_for' && sibling ? rule.todo.replace('[similar skill]', sibling) : rule.todo,
      fixPrompt: describeFix,
    })
  }
  if (total > 0 && correct < total) {
    findings.push({
      level: 'warn',
      about: 'skill',
      field: 'description',
      message: `The AI picked the right skill for ${correct} of ${total} test requests.`,
      why: 'Test requests are examples of what people might ask, each with the skill that should handle it. When the AI picks another skill, people get the wrong help.',
      todo: `${losesTo.length ? `The others went to ${losesTo.slice(0, 3).join(', ')}. ` : ''}Make the description clearer about when to use this skill, or check that the test requests are right.`,
      fixPrompt: describeFix,
    })
  }

  // Pairs
  let staleBodies = 0
  for (const rel of input.relations) {
    if (rel.acknowledgement?.reason) continue
    const isA = getPublishedId(rel.skillA._ref) === self
    const myBodyHash = isA ? rel.body?.hashA : rel.body?.hashB
    if (rel.body && myBodyHash && myBodyHash !== input.bodyHash) staleBodies++

    const fix = relationFix(rel)
    if (!fix) continue
    const otherId = getPublishedId(isA ? rel.skillB._ref : rel.skillA._ref)
    const otherName = (isA ? rel.nameB : rel.nameA) ?? 'Another skill'
    const copy = PAIR_COPY[fix]
    const confused = rel.routing?.confusedRows ?? 0
    findings.push({
      level: copy.level,
      about: 'pair',
      field: copy.field,
      message: copy.message(otherName),
      why: confused
        ? `${copy.why} In test requests, the AI already picked the wrong one of the two ${confused === 1 ? 'once' : `${confused} times`}.`
        : copy.why,
      todo: copy.todo,
      relationId: rel._id,
      fixPrompt: pairFixPrompt(fix, me, {id: otherId, name: otherName}),
    })
  }
  if (staleBodies > 0) {
    findings.push({
      level: 'tip',
      about: 'freshness',
      field: 'content',
      message: `The instructions changed since they were compared with ${staleBodies === 1 ? 'a similar skill' : `${staleBodies} similar skills`}.`,
      todo: RUN_AGAIN,
    })
  }

  // Someone already decided to ship this exact description: say so, don't ask again.
  const override = quality?.overrides?.find((o) => o.descriptionHash === input.descriptionHash)
  const effective = override
    ? findings.map((f) =>
        f.level === 'hold' ? {...f, level: 'warn' as const, why: `Published anyway because: \u201c${override.reason}\u201d`} : f,
      )
    : findings

  const rank = {hold: 0, warn: 1, tip: 2}
  effective.sort((x, y) => rank[x.level] - rank[y.level])
  const level = effective.some((f) => f.level === 'hold') ? 'hold' : effective.some((f) => f.level === 'warn') ? 'warn' : 'clear'
  return {level, findings: effective}
}

// ---- Snapshot on the skill -------------------------------------------------

/**
 * What the last comparison found, as stored on the skill under
 * `metadata.comparison`, so anyone reading the skill (an agent over MCP, a
 * list view) sees it without a second query. The detail stays in
 * `skillQuality` and `skillRelation`.
 */
export type ComparisonSnapshot = {
  status: 'clear' | 'warn' | 'hold'
  summary: string
  findings: Array<{_key: string; _type: 'comparisonFinding'; level: GateFinding['level']; field: GateFinding['field']; message: string; todo?: string}>
  descriptionHash: string
  bodyHash: string
  checkedAt: string
  model: string
}

export function comparisonSnapshot(
  gate: GateResult,
  checked: {descriptionHash: string; bodyHash: string; checkedAt: string; model: string},
): ComparisonSnapshot {
  // Out-of-date notices describe the moment of reading, not what was found.
  const findings = gate.findings.filter((f) => f.about !== 'freshness')
  const holds = findings.filter((f) => f.level === 'hold').length
  const warnings = findings.filter((f) => f.level === 'warn').length
  const status = holds ? 'hold' : warnings ? 'warn' : 'clear'
  const summary =
    findings.length === 0
      ? 'No problems found.'
      : `${findings.length} ${findings.length === 1 ? 'thing' : 'things'} to look at${holds ? '; publishing is paused until the first is sorted out' : ''}.`
  return {
    status,
    summary,
    findings: findings.map((f, i) => ({_key: `f${i}`, _type: 'comparisonFinding', level: f.level, field: f.field, message: f.message, todo: f.todo})),
    ...checked,
  }
}

// ---- Loading -----------------------------------------------------------------

const GATE_QUERY = `{
  "quality": *[_id == $qualityId][0]{lint, routing, overrides, bodyHash},
  "relations": *[_type == "skillRelation" && references($id)]{
    _id, skillA, skillB, "nameA": skillA->skillName, "nameB": skillB->skillName,
    summary, description, body, routing, acknowledgement
  }
}`

/** The stored results the gate reads. Relations and quality are never drafts. */
export async function loadGateDocs(client: SanityClient, skillId: string) {
  const id = getPublishedId(skillId)
  return client.fetch<{quality: StoredQuality | null; relations: StoredRelation[]}>(GATE_QUERY, {
    id,
    qualityId: qualityId(id),
  })
}
