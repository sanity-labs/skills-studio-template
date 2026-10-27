import {describe, it, expect} from 'vitest'
import {assembleSkillMd, getRefFilePath, assembleSkillRelativeFiles} from '../assemble'

describe('assembleSkillMd', () => {
  it('builds correct frontmatter with folded scalar description and date version', () => {
    const result = assembleSkillMd({
      skillName: 'test-skill',
      description: 'A test skill for testing.',
      content: '# Instructions\n\nDo the thing.',
    })

    expect(result).toMatch(
      new RegExp(
        '^---\\n' +
          'name: test-skill\\n' +
          'description: >\\n' +
          '  A test skill for testing\\.\\n' +
          'version: \\d{4}-\\d{2}-\\d{2}\\n' +
          '---\\n' +
          '\\n' +
          '# Instructions\\n' +
          '\\n' +
          'Do the thing\\.\\n$',
      ),
    )
  })

  it('collapses multi-line descriptions into a single folded line', () => {
    const result = assembleSkillMd({
      skillName: 'multi-line',
      description: 'Line one.\nLine two.\nLine three.',
      content: 'Content here.',
    })

    expect(result).toContain('description: >\n  Line one. Line two. Line three.')
  })

  it('includes metadata fields in frontmatter when present', () => {
    const result = assembleSkillMd({
      skillName: 'with-metadata',
      description: 'Has metadata.',
      content: 'Content.',
      metadata: {
        tags: ['voice'],
        visibility: 'confidential',
        owner: 'ada@example.com',
      },
    })

    expect(result).toContain('tags:\n  - voice')
    expect(result).toContain('visibility: confidential')
    expect(result).toContain('owner: ada@example.com')
  })

  it('prefers the owners array over the legacy owner string in frontmatter', () => {
    const result = assembleSkillMd({
      skillName: 'owned',
      description: 'Owned skill.',
      content: 'Content.',
      metadata: {
        owner: 'legacy string',
        owners: [
          {name: 'Ada Lovelace', email: 'ada@example.com'},
          null,
          {name: null, email: 'grace@example.com'},
        ],
      },
    })

    expect(result).toContain('owner: Ada Lovelace <ada@example.com>, grace@example.com')
    expect(result).not.toContain('legacy string')
  })

  describe('invocation', () => {
    const base = {skillName: 'inv', description: 'Invocation test.', content: 'Content.'}
    const keys = /disable-model-invocation|user-invocable|argument-hint/

    it('emits nothing for the default mode or when unset', () => {
      expect(assembleSkillMd(base)).not.toMatch(keys)
      expect(assembleSkillMd({...base, invocation: null})).not.toMatch(keys)
      expect(assembleSkillMd({...base, invocation: {mode: 'default'}})).not.toMatch(keys)
    })

    it('maps "only people" to disable-model-invocation with a quoted hint', () => {
      const result = assembleSkillMd({
        ...base,
        invocation: {mode: 'userOnly', argumentHint: ' [ticket-url] '},
      })
      expect(result).toMatch(
        /\nversion: [\d-]+\ndisable-model-invocation: true\nargument-hint: "\[ticket-url\]"\n---\n/,
      )
      expect(result).not.toContain('user-invocable')
    })

    it('maps "only Claude" to user-invocable: false and drops the hint', () => {
      const result = assembleSkillMd({
        ...base,
        invocation: {mode: 'modelOnly', argumentHint: '[ignored]'},
      })
      expect(result).toContain('\nuser-invocable: false\n')
      expect(result).not.toMatch(/disable-model-invocation|argument-hint/)
    })
  })

  it('handles empty content', () => {
    const result = assembleSkillMd({
      skillName: 'empty',
      description: 'Empty skill.',
      content: '',
    })

    expect(result).toContain('name: empty')
    expect(result).toContain('description: >')
    expect(result.endsWith('---\n\n\n')).toBe(true)
  })
})

describe('getRefFilePath', () => {
  it('appends .md to filenames without extension', () => {
    expect(getRefFilePath('groq')).toBe('groq.md')
    expect(getRefFilePath('brand-voice')).toBe('brand-voice.md')
  })

  it('preserves filenames with extensions', () => {
    expect(getRefFilePath('component-usage.tsx')).toBe('component-usage.tsx')
    expect(getRefFilePath('styles.css')).toBe('styles.css')
    expect(getRefFilePath('data.json')).toBe('data.json')
  })

  it('accepts legacy slug-object filenames', () => {
    expect(getRefFilePath({current: 'paid-organic-playbook'})).toBe('paid-organic-playbook.md')
  })

  it('throws on missing filename', () => {
    expect(() => getRefFilePath(null)).toThrow(/missing a filename/)
  })
})

describe('assembleSkillRelativeFiles', () => {
  it('creates SKILL.md for skill with no references', () => {
    const files = assembleSkillRelativeFiles({
      skillName: 'no-refs',
      description: 'A skill without references.',
      content: 'Just instructions.',
    })

    expect(files).toHaveLength(1)
    expect(files[0].relPath).toBe('SKILL.md')
    expect(files[0].content).toContain('name: no-refs')
  })

  it('creates SKILL.md + reference files', () => {
    const files = assembleSkillRelativeFiles({
      skillName: 'with-refs',
      description: 'A skill with references.',
      content: 'Main content.',
      references: [
        {filename: 'groq', content: '# GROQ Reference'},
        {filename: 'component-usage.tsx', content: 'export const Foo = () => {}'},
      ],
    })

    expect(files).toHaveLength(3)
    expect(files[0].relPath).toBe('SKILL.md')
    expect(files[1].relPath).toBe('references/groq.md')
    expect(files[1].content).toBe('# GROQ Reference\n')
    expect(files[2].relPath).toBe('references/component-usage.tsx')
    expect(files[2].content).toBe('export const Foo = () => {}\n')
  })

  it('skips null references', () => {
    const files = assembleSkillRelativeFiles({
      skillName: 'null-refs',
      description: 'Has null refs.',
      content: 'Content.',
      references: [
        {filename: 'valid', content: 'Valid content'},
        null,
        {filename: 'also-valid', content: 'Also valid'},
      ],
    })

    expect(files).toHaveLength(3) // SKILL.md + 2 valid refs
  })

  it('handles empty references array', () => {
    const files = assembleSkillRelativeFiles({
      skillName: 'empty-refs',
      description: 'Empty refs array.',
      content: 'Content.',
      references: [],
    })

    expect(files).toHaveLength(1) // Just SKILL.md
  })
})
