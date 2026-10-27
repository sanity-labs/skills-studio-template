import {describe, it, expect} from 'vitest'
import {comparisonMarkers} from '../comparisonValidation'
import {textHash} from '../skillSignals'
import type {ComparisonSnapshot} from '../skillGate'

const finding = (level: 'hold' | 'warn' | 'tip', field: 'description' | 'content' = 'description') => ({
  _key: level,
  _type: 'comparisonFinding' as const,
  level,
  field,
  message: `${level} message`,
})

async function skill(findings: ComparisonSnapshot['findings'], edited = false) {
  const snapshot: ComparisonSnapshot = {
    status: 'warn',
    summary: '',
    findings,
    descriptionHash: await textHash('original description'),
    bodyHash: await textHash('body'),
    checkedAt: '2026-10-11T00:00:00Z',
    model: 'm',
  }
  return {description: edited ? 'edited description' : 'original description', content: 'body', metadata: {comparison: snapshot}}
}

describe('comparisonMarkers', () => {
  it('relays each finding at its own level, on its own field', async () => {
    const doc = await skill([finding('hold'), finding('tip', 'content')])
    expect(await comparisonMarkers(doc, 'hold')).toEqual([{message: 'hold message', path: ['description']}])
    expect(await comparisonMarkers(doc, 'tip')).toEqual([{message: 'tip message', path: ['content']}])
    expect(await comparisonMarkers(doc, 'warn')).toBe(true)
  })

  it('asks for a comparison when there has never been one', async () => {
    const markers = await comparisonMarkers({description: 'x'}, 'warn')
    expect(markers).toHaveLength(1)
    expect(await comparisonMarkers({description: 'x'}, 'hold')).toBe(true)
  })

  it('holds back earlier warnings once the text has changed', async () => {
    const doc = await skill([finding('warn'), finding('tip')], true)
    const warnings = await comparisonMarkers(doc, 'warn')
    expect(warnings).toHaveLength(1) // only the "compare again" note
    expect(await comparisonMarkers(doc, 'tip')).toBe(true)
  })

  it('keeps an earlier hold after an edit, so editing is no way around it', async () => {
    const doc = await skill([finding('hold')], true)
    expect(await comparisonMarkers(doc, 'hold')).toHaveLength(1)
  })
})
