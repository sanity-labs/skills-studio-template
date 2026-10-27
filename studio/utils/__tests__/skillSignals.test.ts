import {describe, it, expect} from 'vitest'
import {
  relationId,
  qualityId,
  textHash,
  averageDescriptionAnswers,
  averageBodyAnswers,
  isNotableRelation,
  summarizeRouting,
  pairKey,
  buildRelationDoc,
  buildQualityDoc,
  type DescriptionPairAnswers,
  type BodyPairAnswers,
} from '../skillSignals'

const A = '7f3a1c2e-9b21-4c6d-8a10-5e2f0b7d4c88'
const B = '05bd0a66-d3ca-488e-9ccb-159f7f6bd12e'

const descAnswers = (
  sameTrigger: number,
  probs: Record<string, number>,
  overlap: number,
): DescriptionPairAnswers => ({
  same_trigger: {type: 'noul', noul: sameTrigger},
  relationship: {
    type: 'choice',
    choice: Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0],
    probabilities: probs,
  },
  overlap: {type: 'score', score: overlap},
})

const bodyAnswers = (
  contradicts: number,
  duplicated: number,
  probs: Record<string, number>,
): BodyPairAnswers => ({
  contradicts: {type: 'noul', noul: contradicts},
  duplicated_procedure: {type: 'noul', noul: duplicated},
  action: {
    type: 'choice',
    choice: Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0],
    probabilities: probs,
  },
})

describe('relationId', () => {
  it('is the same whichever skill comes first', () => {
    expect(relationId(A, B)).toBe(relationId(B, A))
  })

  it('names the published skills, not their drafts', () => {
    expect(relationId(`drafts.${A}`, B)).toBe(relationId(A, B))
  })

  it('stays inside the 128-character document id limit', () => {
    expect(relationId(A, B).length).toBeLessThanOrEqual(128)
  })

  it('fits long, readable ids into the limit, still the same in either order', () => {
    const long1 = 'imported-content-modelling-from-concepts-to-schema-in-sanity'
    const long2 = 'imported-content-modelling-session-one-foundations-decision-making'
    expect(relationId(long1, long2).length).toBeLessThanOrEqual(128)
    expect(relationId(long1, long2)).toBe(relationId(long2, long1))
    expect(relationId(long1, long2)).not.toBe(relationId(long1, `${long2}-x`))
  })

  it('refuses a skill paired with itself', () => {
    expect(() => relationId(A, `drafts.${A}`)).toThrow(/itself/)
  })
})

describe('qualityId', () => {
  it('is one document per published skill', () => {
    expect(qualityId(`drafts.${A}`)).toBe(qualityId(A))
  })
})

describe('textHash', () => {
  it('changes when the text changes', async () => {
    expect(await textHash('Use when asked about billing.')).not.toBe(
      await textHash('Use when asked about overages.'),
    )
  })

  it('is stable for the same text', async () => {
    expect(await textHash('same')).toBe(await textHash('same'))
  })
})

describe('averageDescriptionAnswers', () => {
  it('averages both orders and picks the relationship with the most mass', () => {
    const signal = averageDescriptionAnswers([
      descAnswers(0.3, {overlapping_triggers: 0.6, complementary: 0.4}, 2),
      descAnswers(0.5, {overlapping_triggers: 0.2, complementary: 0.8}, 1),
    ])
    expect(signal.sameTrigger).toBeCloseTo(0.4)
    expect(signal.overlap).toBeCloseTo(1.5)
    expect(signal.relationship).toBe('complementary')
    expect(signal.relationshipConfidence).toBeCloseTo(0.6)
  })

  it('counts duplicate, overlapping and supersedes as competing', () => {
    const signal = averageDescriptionAnswers([
      descAnswers(0.1, {duplicate: 0.1, overlapping_triggers: 0.2, supersedes: 0.1, unrelated: 0.6}, 0),
    ])
    expect(signal.competing).toBeCloseTo(0.4)
  })

  it('refuses an empty list rather than inventing a result', () => {
    expect(() => averageDescriptionAnswers([])).toThrow()
  })
})

describe('averageBodyAnswers', () => {
  it('averages both orders and picks the action with the most mass', () => {
    const signal = averageBodyAnswers([
      bodyAnswers(0.6, 0.9, {extract_shared: 0.7, keep: 0.3}),
      bodyAnswers(0.4, 0.7, {extract_shared: 0.5, keep: 0.5}),
    ])
    expect(signal.contradicts).toBeCloseTo(0.5)
    expect(signal.duplicatedProcedure).toBeCloseTo(0.8)
    expect(signal.recommendedAction).toBe('extract_shared')
    expect(signal.actionConfidence).toBeCloseTo(0.6)
  })
})

describe('isNotableRelation', () => {
  const quiet = averageDescriptionAnswers([descAnswers(0.05, {unrelated: 0.9, complementary: 0.1}, 0.2)])

  it('drops a pair Jev considers unrelated', () => {
    expect(isNotableRelation({description: quiet})).toBe(false)
  })

  it('keeps a pair with competing mass', () => {
    const competing = averageDescriptionAnswers([descAnswers(0.1, {overlapping_triggers: 0.3, unrelated: 0.7}, 1)])
    expect(isNotableRelation({description: competing})).toBe(true)
  })

  it('keeps any pair the router confused, whatever the descriptions say', () => {
    expect(isNotableRelation({description: quiet, routing: {confusedRows: 1, mass: 0.4, examples: []}})).toBe(true)
  })

  it('keeps any pair whose bodies were compared', () => {
    const body = averageBodyAnswers([bodyAnswers(0.1, 0.1, {keep: 1})])
    expect(isNotableRelation({description: quiet, body})).toBe(true)
  })
})


describe('summarizeRouting', () => {
  const row = (owner: string, expected: string, choice: string, probabilities: Record<string, number>, acceptable: string[] = []) => ({
    prompt: `${owner} → ${expected}`,
    owner,
    expected,
    acceptable,
    choice,
    confidence: probabilities[choice] ?? 0,
    probabilities,
  })

  const rows = [
    row('viper', 'viper', 'viper-extractor', {'viper-extractor': 0.61, viper: 0.39}),
    row('viper', 'viper', 'viper', {viper: 0.9, 'viper-extractor': 0.1}),
    row('viper', 'none', 'social-copy-helper', {'social-copy-helper': 0.81, none: 0.19}),
    row('meddpicc', 'viper', 'viper', {viper: 1}),
    row('viper', 'viper-extractor', 'viper', {viper: 0.6, 'viper-extractor': 0.4}, ['viper']),
  ]
  const {pairs, skills} = summarizeRouting(rows)

  it('counts a row for the owner and for the expected skill', () => {
    expect(skills.get('viper')?.total).toBe(5)
    expect(skills.get('meddpicc')?.total).toBe(1)
  })

  it('accepts an acceptable skill as correct', () => {
    expect(skills.get('viper-extractor')?.correct).toBe(1)
  })

  it('names who won the rows a skill lost, most often first', () => {
    expect(skills.get('viper')?.losesTo).toEqual(['viper-extractor', 'social-copy-helper'])
  })

  it('records misplaced probability against the pair, in either order', () => {
    const confusion = pairs.get(pairKey('viper-extractor', 'viper'))
    expect(confusion?.confusedRows).toBe(2)
    expect(confusion?.mass).toBeCloseTo(0.71)
  })

  it('does not turn "none" into a pair', () => {
    expect([...pairs.keys()].some((k) => k.includes('none'))).toBe(false)
  })
})

describe('buildRelationDoc', () => {
  const description = averageDescriptionAnswers([descAnswers(0.3, {overlapping_triggers: 1}, 2)])
  const late = {_id: 'zzz', name: 'zeta', descriptionHash: 'dz', bodyHash: 'bz'}
  const early = {_id: 'aaa', name: 'alpha', descriptionHash: 'da', bodyHash: 'ba'}

  it('stores skill A as the lower id, whatever order it was given in', () => {
    const doc = buildRelationDoc({a: late, b: early, signals: {description}, checkedAt: '2026-10-11T00:00:00Z'})
    expect(doc.skillA._ref).toBe('aaa')
    expect(doc._id).toBe(relationId('aaa', 'zzz'))
  })

  it('keeps each hash with its own skill when the order flips', () => {
    const doc = buildRelationDoc({a: late, b: early, signals: {description}, checkedAt: '2026-10-11T00:00:00Z'})
    expect(doc.description).toMatchObject({hashA: 'da', hashB: 'dz'})
  })

  it('writes weak references, so deleting a skill is never blocked by its relations', () => {
    const doc = buildRelationDoc({a: late, b: early, signals: {description}, checkedAt: '2026-10-11T00:00:00Z'})
    expect(doc.skillA._weak).toBe(true)
    expect(doc.skillB._weak).toBe(true)
  })

  it('leaves out blocks that were not checked', () => {
    const doc = buildRelationDoc({a: late, b: early, signals: {description}, checkedAt: '2026-10-11T00:00:00Z'})
    expect(doc).not.toHaveProperty('body')
    expect(doc).not.toHaveProperty('routing')
  })
})

describe('buildQualityDoc', () => {
  it('gives every miss a key and a type, as array items need', () => {
    const doc = buildQualityDoc({
      skill: {_id: 'aaa', name: 'alpha', descriptionHash: 'da'},
      routing: {total: 2, correct: 1, losesTo: ['beta'], misses: [{prompt: 'p', expected: 'alpha', chose: 'beta', confidence: 0.6}]},
      checkedAt: '2026-10-11T00:00:00Z',
    })
    expect(doc.routing?.misses[0]).toMatchObject({_key: expect.any(String), _type: 'routingMiss'})
    expect(doc.routing?.descriptionHash).toBe('da')
  })
})
