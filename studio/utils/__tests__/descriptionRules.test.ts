import {describe, it, expect} from 'vitest'
import {DESCRIPTION_RULES, descriptionRuleQuestions, evaluateDescriptionRules} from '../descriptionRules'

describe('evaluateDescriptionRules', () => {
  it('fails a "warn when no" rule on a low probability', () => {
    const [check] = evaluateDescriptionRules({says_not_for: {noul: 0.03}})
    expect(check).toMatchObject({rule: 'says_not_for', passed: false})
  })

  it('fails a "warn when yes" rule on a high probability', () => {
    const [check] = evaluateDescriptionRules({explains_mechanics: {noul: 0.92}})
    expect(check).toMatchObject({rule: 'explains_mechanics', passed: false})
  })

  it('passes both kinds when the description does the right thing', () => {
    const checks = evaluateDescriptionRules({says_not_for: {noul: 0.9}, explains_mechanics: {noul: 0.03}})
    expect(checks.every((c) => c.passed)).toBe(true)
  })

  it('leaves out a rule Jev didn’t answer instead of passing it', () => {
    expect(evaluateDescriptionRules({})).toEqual([])
  })
})

describe('descriptionRuleQuestions', () => {
  it('asks one yes/no question per rule, keyed by rule id', () => {
    const questions = descriptionRuleQuestions()
    expect(Object.keys(questions)).toEqual(DESCRIPTION_RULES.map((r) => r.id))
    expect(Object.values(questions).every((q) => q.type === 'noul')).toBe(true)
  })
})
