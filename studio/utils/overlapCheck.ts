/**
 * The overlap check behind the "Check overlap" action: what one skill, as
 * currently drafted, competes with, duplicates or contradicts.
 *
 * 1. Route the skill's trigger rows over every description, with this skill's
 *    draft description in place of its published one.
 * 2. Neighbours = skills the router confused with this one, then the caller's
 *    candidates (embedding neighbours, existing relations), capped.
 * 3. Compare each neighbour on descriptions and on bodies, both orders.
 * 4. Lint the description.
 *
 * Every neighbour checked gets a relation written, notable or not, so a
 * re-check after fixing a boundary replaces the old flag rather than leaving
 * it. Routing confusion is set only where this run found some: a relation's
 * confusion can also come from the neighbour's own rows, which this run did
 * not route.
 *
 * Network and storage are the caller's: `decide` is injected and the result is
 * documents to write.
 */
import type {Decision, SkillText} from './jev'
import {BODY_PAIR_QUESTIONS, DESCRIPTION_PAIR_QUESTIONS, pairState, pool, routingQuestions} from './jev'
import {descriptionRuleQuestions, descriptionRuleState, evaluateDescriptionRules} from './descriptionRules'
import {getPublishedId} from './documentIds'
import {
  averageBodyAnswers,
  averageDescriptionAnswers,
  buildQualityDoc,
  buildRelationDoc,
  pairKey,
  summarizeRouting,
  textHash,
  type BodyPairAnswers,
  type DescriptionPairAnswers,
  type JudgedSkill,
  type QualityDoc,
  type RelationDoc,
  type RelationSignals,
} from './skillSignals'

export type LibrarySkill = SkillText & {_id: string; audiences?: string[]}

export type TriggerRow = {prompt: string; owner: string; expected: string; acceptable: string[]}

export type CheckInput = {
  /** The skill as drafted now. */
  skill: LibrarySkill
  /** Every published skill. The checked skill's entry is replaced by `skill`. */
  library: LibrarySkill[]
  /** Published ids worth comparing, most promising first. */
  candidates: string[]
  /** Trigger rows owned by or expecting this skill. */
  rows: TriggerRow[]
}

export type CheckDeps = {
  decide: (state: unknown, questions: Record<string, Record<string, unknown>>) => Promise<Decision<any>>
  now: () => string
  concurrency?: number
  onProgress?: (message: string) => void
}

export type CheckResult = {
  relations: RelationDoc[]
  quality: QualityDoc
  /** The checked skill as judged, with the hashes of its draft text. */
  self: JudgedSkill
  /** Skill names by published id, for naming the other skill in each pair. */
  names: Record<string, string>
  cost: number
}

export const MAX_NEIGHBOURS = 10

/**
 * Jev's context is 32k tokens. Past this many characters of descriptions the
 * routing question would not fit, so routing narrows to what someone in the
 * skill's audiences has installed: Everyone plus their own plugins.
 */
export const ROUTING_CHAR_BUDGET = 100_000

export function routingLibrary(library: LibrarySkill[], skill: LibrarySkill): LibrarySkill[] {
  const size = library.reduce((sum, s) => sum + s.description.length, 0)
  if (size <= ROUTING_CHAR_BUDGET) return library
  const audiences = new Set(['Everyone', ...(skill.audiences ?? [])])
  const id = getPublishedId(skill._id)
  return library.filter((s) => getPublishedId(s._id) === id || s.audiences?.some((a) => audiences.has(a)))
}

export async function runOverlapCheck(input: CheckInput, deps: CheckDeps): Promise<CheckResult> {
  const {decide, now, concurrency = 6, onProgress = () => {}} = deps
  const skillId = getPublishedId(input.skill._id)
  const skill = {...input.skill, _id: skillId}
  const library = [skill, ...input.library.filter((s) => getPublishedId(s._id) !== skillId)]
  const byName = new Map(library.map((s) => [s.skillName, s]))
  const byId = new Map(library.map((s) => [getPublishedId(s._id), s]))
  let cost = 0
  const ask = async <A>(state: unknown, questions: Record<string, Record<string, unknown>>) => {
    const result = (await decide(state, questions)) as Decision<A>
    cost += result.cost
    return result.answers
  }

  // 1. Routing
  onProgress(`Trying ${input.rows.length} test requests`)
  const routingQuestion = routingQuestions(routingLibrary(library, skill))
  type RouteAnswer = {skill: {choice: string; confidence?: number; probabilities?: Record<string, number>}}
  const routed = await pool(input.rows, concurrency, async (row) => {
    const {skill: answer} = await ask<RouteAnswer>(row.prompt, routingQuestion)
    const probabilities = answer.probabilities ?? {}
    return {...row, choice: answer.choice, confidence: answer.confidence ?? probabilities[answer.choice] ?? 0, probabilities}
  })
  const routing = summarizeRouting(routed)

  // 2. Neighbours
  const confusedWith = [...routing.pairs.keys()]
    .map((key) => key.split('|'))
    .filter((names) => names.includes(skill.skillName))
    .map((names) => byName.get(names.find((n) => n !== skill.skillName)!))
    .filter((s): s is LibrarySkill => Boolean(s))
    .map((s) => getPublishedId(s._id))
  const neighbours = [...new Set([...confusedWith, ...input.candidates.map(getPublishedId)])]
    .filter((id) => id !== skillId && byId.has(id))
    .slice(0, MAX_NEIGHBOURS)
    .map((id) => byId.get(id)!)

  // 3. Pairs
  onProgress(`Comparing with ${neighbours.length} similar skills`)
  const judged = async (s: LibrarySkill): Promise<JudgedSkill> => ({
    _id: getPublishedId(s._id),
    name: s.skillName,
    descriptionHash: await textHash(s.description),
    bodyHash: await textHash(s.content ?? ''),
  })
  const self = await judged(skill)
  const checkedAt = now()

  const relations = await pool(neighbours, concurrency, async (other) => {
    const orders: Array<[SkillText, SkillText]> = [
      [skill, other],
      [other, skill],
    ]
    const description = await Promise.all(
      orders.map(([a, b]) => ask<DescriptionPairAnswers>(pairState(a, b, {withBody: false}), DESCRIPTION_PAIR_QUESTIONS)),
    )
    const signals: RelationSignals = {description: averageDescriptionAnswers(description)}
    if (skill.content && other.content) {
      const body = await Promise.all(
        orders.map(([a, b]) => ask<BodyPairAnswers>(pairState(a, b, {withBody: true}), BODY_PAIR_QUESTIONS)),
      )
      signals.body = averageBodyAnswers(body)
    }
    const confusion = routing.pairs.get(pairKey(skill.skillName, other.skillName))
    if (confusion) signals.routing = confusion
    return buildRelationDoc({a: self, b: await judged(other), signals, checkedAt})
  })

  // 4. Lint
  onProgress('Checking the description')
  const ruleAnswers = await ask<Record<string, {noul?: number}>>(descriptionRuleState(skill), descriptionRuleQuestions())

  const quality = buildQualityDoc({
    skill: self,
    checks: evaluateDescriptionRules(ruleAnswers),
    routing: input.rows.length ? routing.skills.get(skill.skillName) : undefined,
    checkedAt,
  })

  const names = Object.fromEntries(library.map((s) => [getPublishedId(s._id), s.skillName]))
  return {relations, quality, self, names, cost}
}
