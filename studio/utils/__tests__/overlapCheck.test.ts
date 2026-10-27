import {describe, it, expect} from 'vitest'
import {runOverlapCheck, routingLibrary, ROUTING_CHAR_BUDGET, type LibrarySkill} from '../overlapCheck'
import {relationId, textHash} from '../skillSignals'

const skill = (id: string, name: string, extra: Partial<LibrarySkill> = {}): LibrarySkill => ({
  _id: id,
  skillName: name,
  title: name,
  description: `${name} published description`,
  content: `${name} body`,
  audiences: ['Field'],
  ...extra,
})

const viper = skill('id-viper', 'viper')
const extractor = skill('id-extractor', 'viper-extractor')
const sales = skill('id-sales', 'sanity-sales-process')
const bigquery = skill('id-bq', 'bigquery-mcp', {content: ''})
const library = [viper, extractor, sales, bigquery]

const draft = {...viper, _id: 'drafts.id-viper', description: 'viper DRAFT description'}

type Call = {state: unknown; questions: Record<string, unknown>}

/** Answers every question type the check asks; records what it was asked. */
function fakeJev(routeTo: (prompt: string) => Record<string, number> = () => ({viper: 1})) {
  const calls: Call[] = []
  const decide = async (state: unknown, questions: Record<string, unknown>) => {
    calls.push({state, questions})
    const answers: Record<string, unknown> = {}
    if ('skill' in questions) {
      const probabilities = routeTo(state as string)
      const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0]
      answers.skill = {type: 'choice', choice, probabilities}
    }
    if ('same_trigger' in questions) {
      answers.same_trigger = {type: 'noul', noul: 0.3}
      answers.relationship = {type: 'choice', choice: 'complementary', probabilities: {complementary: 1}}
      answers.overlap = {type: 'score', score: 1}
    }
    if ('contradicts' in questions) {
      answers.contradicts = {type: 'noul', noul: 0.1}
      answers.duplicated_procedure = {type: 'noul', noul: 0.2}
      answers.action = {type: 'choice', choice: 'keep', probabilities: {keep: 1}}
    }
    if ('says_job' in questions) {
      for (const key of Object.keys(questions)) answers[key] = {type: 'noul', noul: key === 'explains_mechanics' ? 0.1 : 0.9}
    }
    return {answers, cost: 0.001}
  }
  return {decide, calls}
}

const rows = [
  {prompt: 'grade this S1', owner: 'viper', expected: 'viper', acceptable: []},
  {prompt: 'fill the VIPER fields', owner: 'viper', expected: 'viper', acceptable: []},
]
const now = () => '2026-10-11T12:00:00Z'

describe('runOverlapCheck', () => {
  it('routes over the draft description, not the published one', async () => {
    const jev = fakeJev()
    await runOverlapCheck({skill: draft, library, candidates: [], rows}, {decide: jev.decide, now})
    const routed = jev.calls.find((c) => 'skill' in c.questions)!
    const criteria = (routed.questions.skill as {criteria: Record<string, string>}).criteria
    expect(criteria.viper).toBe('viper DRAFT description')
  })

  it('adds a skill the router confused with this one, even when no candidate named it', async () => {
    const jev = fakeJev((prompt): Record<string, number> => (prompt === 'fill the VIPER fields' ? {'viper-extractor': 0.6, viper: 0.4} : {viper: 1}))
    const result = await runOverlapCheck({skill: draft, library, candidates: [], rows}, {decide: jev.decide, now})
    const ids = result.relations.map((r) => r._id)
    expect(ids).toContain(relationId('id-viper', 'id-extractor'))
    expect(result.relations.find((r) => r._id === relationId('id-viper', 'id-extractor'))?.routing?.confusedRows).toBe(1)
  })

  it('never relates a skill to itself', async () => {
    const jev = fakeJev()
    const result = await runOverlapCheck(
      {skill: draft, library, candidates: ['id-viper', 'id-sales'], rows},
      {decide: jev.decide, now},
    )
    expect(result.relations.map((r) => r._id)).toEqual([relationId('id-viper', 'id-sales')])
  })

  it('asks every pair in both orders', async () => {
    const jev = fakeJev()
    await runOverlapCheck({skill: draft, library, candidates: ['id-sales'], rows: []}, {decide: jev.decide, now})
    const descriptionCalls = jev.calls.filter((c) => 'same_trigger' in c.questions)
    const firstNames = descriptionCalls.map((c) => (c.state as {skill_a: {name: string}}).skill_a.name).sort()
    expect(firstNames).toEqual(['sanity-sales-process', 'viper'])
  })

  it('skips the body comparison when either skill has no body', async () => {
    const jev = fakeJev()
    const result = await runOverlapCheck({skill: draft, library, candidates: ['id-bq'], rows: []}, {decide: jev.decide, now})
    expect(jev.calls.some((c) => 'contradicts' in c.questions)).toBe(false)
    expect(result.relations[0]).not.toHaveProperty('body')
  })

  it('stamps the skill side with hashes of the draft text', async () => {
    const jev = fakeJev()
    const result = await runOverlapCheck({skill: draft, library, candidates: ['id-sales'], rows: []}, {decide: jev.decide, now})
    const relation = result.relations[0]
    const draftHash = await textHash('viper DRAFT description')
    // id-sales < id-viper, so viper is skill B
    expect(relation.description.hashB).toBe(draftHash)
    expect(result.quality.lint?.descriptionHash).toBe(draftHash)
  })

  it('writes routing results only when the skill has trigger rows', async () => {
    const jev = fakeJev()
    const result = await runOverlapCheck({skill: draft, library, candidates: [], rows: []}, {decide: jev.decide, now})
    expect(result.quality).not.toHaveProperty('routing')
    expect(result.quality.lint).toBeDefined()
  })

  it('adds up what the check cost', async () => {
    const jev = fakeJev()
    const result = await runOverlapCheck({skill: draft, library, candidates: ['id-sales'], rows}, {decide: jev.decide, now})
    // 2 rows + 2 description + 2 body + 1 lint
    expect(result.cost).toBeCloseTo(0.007)
  })
})

describe('routingLibrary', () => {
  it('routes over the whole library while it fits', () => {
    expect(routingLibrary(library, draft)).toHaveLength(4)
  })

  it('narrows to what the skill’s audiences have installed once it does not fit', () => {
    const long = 'x'.repeat(ROUTING_CHAR_BUDGET)
    const big = [
      ...library,
      skill('id-mkt', 'ad-writing', {audiences: ['Marketing'], description: long}),
      skill('id-all', 'authentic-content', {audiences: ['Everyone']}),
    ]
    const names = routingLibrary(big, draft).map((s) => s.skillName)
    expect(names).toContain('authentic-content')
    expect(names).not.toContain('ad-writing')
  })
})
