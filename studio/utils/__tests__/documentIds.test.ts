import {describe, it, expect} from 'vitest'
import {getPublishedId, isVersionId, resolveWriteTarget} from '../documentIds'

const PUBLISHED = '7f3a1c2e-9b21-4c6d-8a10-5e2f0b7d4c88'
const DRAFT = `drafts.${PUBLISHED}`
const VERSION = `versions.rSummerDrop.${PUBLISHED}`

describe('getPublishedId', () => {
  it('returns the published ID for all three forms', () => {
    expect(getPublishedId(PUBLISHED)).toBe(PUBLISHED)
    expect(getPublishedId(DRAFT)).toBe(PUBLISHED)
    expect(getPublishedId(VERSION)).toBe(PUBLISHED)
  })

  // The bug this file exists for: `replace(/^drafts\./, '')` leaves a version
  // ID intact, so it was handed on as if it were a published ID.
  it('is not what a drafts-prefix strip does to a version ID', () => {
    expect(VERSION.replace(/^drafts\./, '')).toBe(VERSION)
    expect(getPublishedId(VERSION)).not.toBe(VERSION)
  })
})

describe('isVersionId', () => {
  it('only recognizes release versions', () => {
    expect(isVersionId(VERSION)).toBe(true)
    expect(isVersionId(DRAFT)).toBe(false)
    expect(isVersionId(PUBLISHED)).toBe(false)
  })
})

describe('resolveWriteTarget', () => {
  it('targets the draft for a published ID', () => {
    expect(resolveWriteTarget(PUBLISHED)).toEqual({
      kind: 'draft',
      id: DRAFT,
      publishedId: PUBLISHED,
    })
  })

  it('targets the same draft when handed a draft ID', () => {
    expect(resolveWriteTarget(DRAFT)).toEqual({
      kind: 'draft',
      id: DRAFT,
      publishedId: PUBLISHED,
    })
  })

  it('targets the version document itself inside a release', () => {
    expect(resolveWriteTarget(VERSION)).toEqual({
      kind: 'version',
      id: VERSION,
      publishedId: PUBLISHED,
      releaseId: 'rSummerDrop',
    })
  })

  it('never nests a drafts prefix in front of a version ID', () => {
    expect(resolveWriteTarget(VERSION).id).not.toContain('drafts.')
  })
})
