import {describe, it, expect} from 'vitest'
import {createSlugger} from '../listItemIds'

describe('createSlugger', () => {
  it('suffixes values that would otherwise collide', () => {
    // The pair that took down the structure pane: two distinct tags in the
    // dataset that slugify to the same string.
    const slugify = createSlugger()
    expect(slugify('buying-committee')).toBe('buying-committee')
    expect(slugify('buying committee')).toBe('buying-committee-2')
  })

  it('keeps separate lists independent', () => {
    const tagIds = createSlugger()
    const ownerIds = createSlugger()
    expect(tagIds('shared')).toBe('shared')
    expect(ownerIds('shared')).toBe('shared')
  })
})
