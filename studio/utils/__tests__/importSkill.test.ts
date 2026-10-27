import {describe, it, expect} from 'vitest'
import {parseRepoSkill, parseOwners, roundTripDiffs, type RepoSkillFile} from '../importSkill'
import {assembleSkillRelativeFiles} from '../assemble'

const skillMd = (frontmatter: string, body = '# Title\n\nBody text.') => `---\n${frontmatter}\n---\n\n${body}\n`
const files = (...extra: RepoSkillFile[]) => (md: string) => [{relPath: 'SKILL.md', content: md}, ...extra]

describe('parseOwners', () => {
  it('reads the assembleSkillMd format', () => {
    expect(parseOwners('Ada Lovelace <ada@example.com>, grace@example.com, Linus')).toEqual([
      {name: 'Ada Lovelace', email: 'ada@example.com'},
      {email: 'grace@example.com'},
      {name: 'Linus'},
    ])
  })
})

describe('parseRepoSkill', () => {
  it('maps frontmatter onto skill fields', () => {
    const md = skillMd(
      'name: my-skill\ndescription: >\n  Use this when\n  testing.\nversion: 2026-10-16\ndisable-model-invocation: true\nargument-hint: "[url]"\ntags:\n  - a\n  - b\nvisibility: confidential\nowner: Ada <ada@example.com>',
      '# My skill\n\nSee references/zeta.md, then references/alpha.md.',
    )
    const parsed = parseRepoSkill(
      'my-skill',
      files(
        {relPath: 'references/alpha.md', content: 'alpha\n'},
        {relPath: 'references/zeta.md', content: 'zeta\n'},
        {relPath: 'evals/cases.json', content: '{}'},
      )(md),
    )
    expect(parsed.problems).toEqual([])
    expect(parsed.missing).toEqual([])
    expect(parsed).toMatchObject({
      skillName: 'my-skill',
      title: 'My skill',
      description: 'Use this when testing.',
      tags: ['a', 'b'],
      visibility: 'confidential',
      owners: [{name: 'Ada', email: 'ada@example.com'}],
      invocation: {mode: 'userOnly', argumentHint: '[url]'},
      unmanaged: ['evals/cases.json'],
    })
    // Order of first mention in the body, not alphabetical.
    expect(parsed.references).toEqual([
      {filename: 'zeta', content: 'zeta'},
      {filename: 'alpha', content: 'alpha'},
    ])
  })

  it('reports metadata the reviewer has to fill in', () => {
    const parsed = parseRepoSkill('my-skill', files()(skillMd('name: my-skill\ndescription: Use it.')))
    expect(parsed.problems).toEqual([])
    expect(parsed.missing).toEqual(['tags', 'visibility', 'owners'])
  })

  it('refuses what a Studio publish would lose or break', () => {
    const parsed = parseRepoSkill(
      'other-name',
      files({relPath: 'references/deep/file.md', content: 'x'})(
        skillMd('name: my-skill\ndescription: Use it.\nallowed-tools: Bash\nvisibility: public'),
      ),
    )
    expect(parsed.problems).toEqual([
      '`name: my-skill` must match the folder name `other-name`',
      'Frontmatter keys with no Studio field would be dropped on publish: allowed-tools',
      '`visibility: public` must be shareable or confidential',
      'references/deep/file.md: the Studio only holds flat references/<file>, not subfolders',
    ])
  })
})

describe('roundTripDiffs', () => {
  it('is empty for anything assembleSkillMd wrote', () => {
    const skill = {
      skillName: 'my-skill',
      description: 'Use it.',
      content: '# Title\n\nBody.',
      metadata: {tags: ['x'], visibility: 'shareable', owners: [{name: 'Ada', email: 'ada@example.com'}]},
      invocation: {mode: 'modelOnly' as const},
      references: [{filename: 'notes', content: 'Notes.'}, {filename: 'example.tsx', content: 'export {}'}],
    }
    const repo = assembleSkillRelativeFiles(skill).map(({relPath, content}) => ({relPath, content}))
    const parsed = parseRepoSkill('my-skill', repo)
    expect(parsed.problems).toEqual([])
    expect(roundTripDiffs(parsed, repo)).toEqual([])
  })

  it('names the first line a publish would reformat', () => {
    const repo = [{relPath: 'SKILL.md', content: '---\ndescription: Use it.\nname: my-skill\n---\n# Title'}]
    expect(roundTripDiffs(parseRepoSkill('my-skill', repo), repo)).toEqual([
      {relPath: 'SKILL.md', line: 2, repo: 'description: Use it.', studio: 'name: my-skill'},
    ])
  })

  it('round-trips a PR-authored skill with frontmatter formatting only', () => {
    const repo = [
      {relPath: 'SKILL.md', content: '---\nname: my-skill\ndescription: Use it when testing.\n---\n\n# Title\n'},
    ]
    const parsed = parseRepoSkill('my-skill', repo)
    expect(parsed.problems).toEqual([])
    // A plain one-line description becomes the folded `>` block assembleSkillMd writes.
    expect(roundTripDiffs(parsed, repo)[0]).toEqual(
      expect.objectContaining({relPath: 'SKILL.md', line: 3, studio: 'description: >'}),
    )
  })
})
