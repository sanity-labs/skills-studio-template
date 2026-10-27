import {describe, it, expect} from 'vitest'
import {comparisonSnapshot, evaluateGate, type GateInput, type StoredRelation} from '../skillGate'

const SELF = 'id-viper'
const OTHER = 'id-zeta'

const relation = (overrides: Partial<StoredRelation> = {}): StoredRelation => ({
  _id: `skillRelation.${SELF}.${OTHER}`,
  skillA: {_ref: SELF},
  skillB: {_ref: OTHER},
  nameA: 'viper',
  nameB: 'zeta',
  summary: 'viper and zeta: complementary.',
  description: {relationship: 'complementary', competing: 0.05, sameTrigger: 0.05, overlap: 1, hashA: 'd-now', hashB: 'z'},
  ...overrides,
})

const input = (overrides: Partial<GateInput> = {}): GateInput => ({
  skillId: SELF,
  skillName: 'viper',
  descriptionHash: 'd-now',
  bodyHash: 'b-now',
  quality: {
    lint: {
      checks: [
        {rule: 'says_job', title: 'Says what it helps with', probability: 0.9, passed: true},
        {rule: 'explains_mechanics', title: 'Explains how it works', probability: 0.1, passed: true},
      ],
      descriptionHash: 'd-now',
    },
    routing: {total: 4, correct: 4, losesTo: [], descriptionHash: 'd-now'},
  },
  relations: [relation()],
  ...overrides,
})

describe('evaluateGate', () => {
  it('clears a skill whose checks are current and quiet', () => {
    expect(evaluateGate(input()).level).toBe('clear')
  })

  it('warns, without pausing, when a skill has never been compared', () => {
    expect(evaluateGate(input({quality: null, relations: []})).level).toBe('warn')
  })

  it('warns, without pausing, when the description changed since the last comparison', () => {
    expect(evaluateGate(input({descriptionHash: 'd-edited'})).level).toBe('warn')
  })

  it('holds on an unacknowledged duplicate', () => {
    const result = evaluateGate(input({relations: [relation({description: {...relation().description, relationship: 'duplicate'}})]}))
    expect(result.level).toBe('hold')
    expect(result.findings[0].relationId).toBe(`skillRelation.${SELF}.${OTHER}`)
  })

  it('holds when the bodies say merge', () => {
    const result = evaluateGate(
      input({relations: [relation({body: {contradicts: 0.1, duplicatedProcedure: 0.99, recommendedAction: 'merge', hashA: 'b-now', hashB: 'z'}})]}),
    )
    expect(result.level).toBe('hold')
  })

  it('lets an acknowledged pair through', () => {
    const result = evaluateGate(
      input({
        relations: [
          relation({
            description: {...relation().description, relationship: 'duplicate'},
            acknowledgement: {reason: 'Being merged next sprint'},
          }),
        ],
      }),
    )
    expect(result.level).toBe('clear')
  })

  it('warns, without holding, on competing triggers', () => {
    const result = evaluateGate(input({relations: [relation({description: {...relation().description, competing: 0.3}})]}))
    expect(result.level).toBe('warn')
  })

  it('warns on a likely contradiction between bodies', () => {
    const result = evaluateGate(
      input({relations: [relation({body: {contradicts: 0.7, duplicatedProcedure: 0.1, recommendedAction: 'keep', hashA: 'b-now', hashB: 'z'}})]}),
    )
    expect(result.level).toBe('warn')
  })

  it('warns when the router loses rows to other skills', () => {
    const result = evaluateGate(
      input({quality: {...input().quality!, routing: {total: 4, correct: 2, losesTo: ['viper-extractor'], descriptionHash: 'd-now'}}}),
    )
    expect(result.level).toBe('warn')
  })

  it('warns on a description rule that failed, with a fix prompt', () => {
    const lint = {checks: [{rule: 'explains_mechanics', title: 'Explains how it works', probability: 0.92, passed: false}], descriptionHash: 'd-now'}
    const result = evaluateGate(input({quality: {...input().quality!, lint}}))
    expect(result.level).toBe('warn')
    expect(result.findings[0].fixPrompt).toContain(SELF)
  })

  it('reads the hash from the side of the pair this skill is on', () => {
    // Self as skill B, with a body result judged on a different body.
    const flipped = relation({
      skillA: {_ref: OTHER},
      skillB: {_ref: SELF},
      body: {contradicts: 0.1, duplicatedProcedure: 0.1, recommendedAction: 'keep', hashA: 'b-now', hashB: 'b-old'},
    })
    const result = evaluateGate(input({relations: [flipped]}))
    expect(result.findings.some((f) => f.about === 'freshness' && f.field === 'content')).toBe(true)
  })

  it('downgrades a hold to a warning once someone has allowed it for this exact description', () => {
    const quality = {...input().quality!, overrides: [{reason: 'Both needed', descriptionHash: 'd-now'}]}
    expect(evaluateGate(input({quality, relations: [relation({description: {...relation().description, relationship: 'duplicate'}})]})).level).toBe('warn')
  })

  it('does not carry an override over to a newer description', () => {
    const quality = {...input().quality!, overrides: [{reason: 'Old', descriptionHash: 'd-older'}]}
    expect(evaluateGate(input({quality, relations: [relation({description: {...relation().description, relationship: 'duplicate'}})]})).level).toBe('hold')
  })
})


describe('fix prompts on findings', () => {
  it('offers a prompt that names the other skill for a pair that needs editing', () => {
    const result = evaluateGate(input({relations: [relation({description: {...relation().description, competing: 0.3}})]}))
    expect(result.findings[0].fixPrompt).toContain(OTHER)
  })

  it('offers a description rewrite when the AI picks other skills', () => {
    const result = evaluateGate(
      input({quality: {...input().quality!, routing: {total: 4, correct: 2, losesTo: ['viper-extractor'], descriptionHash: 'd-now'}}}),
    )
    expect(result.findings[0].fixPrompt).toContain(SELF)
  })

  it('offers no prompt for something editing can\u2019t fix', () => {
    const result = evaluateGate(input({descriptionHash: 'd-edited'}))
    expect(result.findings[0].fixPrompt).toBeUndefined()
  })
})

describe('comparisonSnapshot', () => {
  const checked = {descriptionHash: 'd', bodyHash: 'b', checkedAt: '2026-10-11T00:00:00Z', model: 'm'}

  it('stores what was found, not that the results are out of date', () => {
    const snapshot = comparisonSnapshot(
      {level: 'hold', findings: [{level: 'hold', about: 'freshness', field: 'description', message: 'changed'}]},
      checked,
    )
    expect(snapshot.status).toBe('clear')
    expect(snapshot.findings).toEqual([])
  })

  it('pauses when a finding pauses publishing, with a key per finding', () => {
    const snapshot = comparisonSnapshot(
      {
        level: 'hold',
        findings: [
          {level: 'hold', about: 'pair', field: 'description', message: 'duplicate'},
          {level: 'warn', about: 'skill', field: 'description', message: 'vague'},
        ],
      },
      checked,
    )
    expect(snapshot.status).toBe('hold')
    expect(new Set(snapshot.findings.map((f) => f._key)).size).toBe(2)
  })
})
