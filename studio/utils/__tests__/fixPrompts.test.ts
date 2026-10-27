import {describe, it, expect} from 'vitest'
import {descriptionFixPrompt, pairFixPrompt, relationFix, testRequestsPrompt} from '../fixPrompts'
import {SANITY_PROJECT_ID, SANITY_DATASET} from '../constants'

const viper = {id: 'id-viper', name: 'viper'}
const extractor = {id: 'id-extractor', name: 'viper-extractor'}

describe('every fix prompt', () => {
  const prompts = [
    descriptionFixPrompt({skill: viper, failedRules: ['explains_mechanics'], losesTo: []}),
    pairFixPrompt('clarify', viper, extractor),
    pairFixPrompt('extract', viper, extractor),
    pairFixPrompt('contradict', viper, extractor),
    pairFixPrompt('merge', viper, extractor),
    testRequestsPrompt(viper),
  ]

  it('names the Sanity project and dataset, so the agent edits the right place', () => {
    for (const prompt of prompts) {
      expect(prompt).toContain(SANITY_PROJECT_ID)
      expect(prompt).toContain(SANITY_DATASET)
    }
  })

  it('names the documents by id', () => {
    for (const prompt of prompts) expect(prompt).toContain('id-viper')
  })

  it('keeps the change in a draft for a person to review', () => {
    for (const prompt of prompts) {
      expect(prompt).toMatch(/draft/i)
      expect(prompt).toMatch(/do not publish/i)
    }
  })
})

describe('pairFixPrompt', () => {
  it('names both skills', () => {
    expect(pairFixPrompt('clarify', viper, extractor)).toContain('id-extractor')
  })

  it('never lets an agent delete or unpublish a skill when proposing a merge', () => {
    expect(pairFixPrompt('merge', viper, extractor)).toMatch(/do not delete or unpublish/i)
  })
})

describe('descriptionFixPrompt', () => {
  it('points at the skills that took this one’s requests', () => {
    expect(descriptionFixPrompt({skill: viper, failedRules: [], losesTo: ['viper-extractor']})).toContain('viper-extractor')
  })

})

describe('relationFix', () => {
  const base = {description: {relationship: 'complementary', competing: 0, sameTrigger: 0}}

  it('suggests a merge for a duplicate before anything else', () => {
    expect(relationFix({...base, description: {...base.description, relationship: 'duplicate'}, body: {contradicts: 0.9}})).toBe('merge')
  })

  it('suggests resolving a contradiction before extracting shared text', () => {
    expect(relationFix({...base, body: {contradicts: 0.7, recommendedAction: 'extract_shared'}})).toBe('contradict')
  })

  it('suggests clarifying descriptions when the AI mixes the two up', () => {
    expect(relationFix({...base, routing: {confusedRows: 1}})).toBe('clarify')
  })

  it('suggests nothing for a pair that needs nothing', () => {
    expect(relationFix(base)).toBeNull()
  })
})

