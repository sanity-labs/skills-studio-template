import {describe, it, expect} from 'vitest'
import {
  generateMarketplaceFiles,
  generateOverviewSkills,
  computeSkillTreeChanges,
  pluginFolder,
  resolveSyncAudiences,
} from '../marketplace'
import type {Audience} from '../marketplace'
import {skillsConfig} from '../../../skills.config'

const EVERYONE_FOLDER = skillsConfig.everyonePluginName
const MARKETPLACE = skillsConfig.marketplace.name

const EVERYONE: Audience = {
  slug: 'everyone',
  title: 'Everyone',
  pluginTitle: 'Org-wide skills',
  pluginDescription: 'Org-wide skills.',
  autoInstall: true,
  pluginName: EVERYONE_FOLDER,
  skillCount: 11,
}
const FIELD: Audience = {
  autoInstall: false,
  pluginName: null,
  pluginTitle: null,
  slug: 'field',
  title: 'Field',
  pluginDescription: 'Skills for the Field organization.',
  skillCount: 33,
}
const MARKETING: Audience = {
  autoInstall: false,
  pluginName: null,
  pluginTitle: null,
  slug: 'marketing',
  title: 'Marketing',
  pluginDescription: 'Skills for Marketing.',
  skillCount: 12,
  overviewNotes: '## Team conventions\n\nAlways run copy past the style-guide skill.',
}
const EMPTY: Audience = {
  autoInstall: false,
  pluginName: null,
  pluginTitle: null,
  slug: 'people',
  title: 'People',
  pluginDescription: 'Skills for the People team.',
  skillCount: 0,
}

const ALL = [FIELD, EVERYONE, MARKETING, EMPTY]

/**
 * How an audience arrives on the skill side: the per-skill projection
 * dereferences the audience document without a skill count or overviewNotes.
 */
const ROUTED_EMPTY: Audience = {
  autoInstall: false,
  pluginName: null,
  pluginTitle: null,
  slug: 'people',
  title: 'People',
  pluginDescription: 'Skills for the People team.',
}
/** An audience document that routing can see but ALL_AUDIENCES_QUERY cannot. */
const UNPUBLISHED: Audience = {
  autoInstall: false,
  pluginName: null,
  pluginTitle: null,
  slug: 'beta',
  title: 'Beta',
  pluginDescription: 'Skills under evaluation.',
}

describe('pluginFolder', () => {
  it('uses the slug by default', () => {
    expect(pluginFolder(FIELD)).toBe('field')
  })

  it('honors the pluginName override (Everyone → legacy folder)', () => {
    expect(pluginFolder(EVERYONE)).toBe(EVERYONE_FOLDER)
  })
})

describe('generateMarketplaceFiles', () => {
  it('generates manifests for Claude Code, Cursor, GitHub Copilot, and Codex', () => {
    const files = generateMarketplaceFiles(ALL)
    const paths = files.map((f) => f.path)

    expect(paths).toContain('.claude-plugin/marketplace.json')
    expect(paths).toContain('.cursor-plugin/marketplace.json')
    expect(paths).toContain('.github/plugin/marketplace.json')
    expect(paths).toContain('.agents/plugins/marketplace.json')
  })

  it('Claude / Cursor / Copilot share identical content', () => {
    const files = generateMarketplaceFiles(ALL)
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]))

    expect(byPath['.claude-plugin/marketplace.json']).toBe(byPath['.cursor-plugin/marketplace.json'])
    expect(byPath['.cursor-plugin/marketplace.json']).toBe(byPath['.github/plugin/marketplace.json'])
    expect(byPath['.agents/plugins/marketplace.json']).not.toBe(
      byPath['.claude-plugin/marketplace.json'],
    )
  })

  it('lists one plugin per audience with published skills, sorted by folder', () => {
    const files = generateMarketplaceFiles(ALL)
    const shared = JSON.parse(files.find((f) => f.path === '.claude-plugin/marketplace.json')!.content)

    expect(shared.plugins.map((p: any) => p.name)).toEqual([
      'field',
      'marketing',
      EVERYONE_FOLDER,
    ])
  })

  it('uses pluginTitle as displayName, falling back to the audience title', () => {
    const files = generateMarketplaceFiles(ALL)
    const shared = JSON.parse(files.find((f) => f.path === '.claude-plugin/marketplace.json')!.content)
    const byName = Object.fromEntries(shared.plugins.map((p: any) => [p.name, p]))

    expect(byName[EVERYONE_FOLDER].displayName).toBe('Org-wide skills')
    expect(byName['field'].displayName).toBe('Field')

    const pluginJson = JSON.parse(
      files.find((f) => f.path === `${EVERYONE_FOLDER}/.claude-plugin/plugin.json`)!.content,
    )
    expect(pluginJson.displayName).toBe('Org-wide skills')
  })

  it('omits audiences without published skills', () => {
    const files = generateMarketplaceFiles(ALL)
    const shared = JSON.parse(files.find((f) => f.path === '.claude-plugin/marketplace.json')!.content)

    expect(shared.plugins.some((p: any) => p.name === 'people')).toBe(false)
  })

  it('intentionally omits versions (git commits act as versions) and skills arrays (auto-discovery)', () => {
    const files = generateMarketplaceFiles(ALL)
    const shared = JSON.parse(files.find((f) => f.path === '.claude-plugin/marketplace.json')!.content)

    for (const plugin of shared.plugins) {
      expect(plugin.version).toBeUndefined()
      expect(plugin.skills).toBeUndefined()
    }
  })

  it('writes plugin.json (Claude + Codex shapes) for each active plugin folder', () => {
    const files = generateMarketplaceFiles(ALL)
    const paths = files.map((f) => f.path)

    for (const folder of [EVERYONE_FOLDER, 'field', 'marketing']) {
      expect(paths).toContain(`${folder}/.claude-plugin/plugin.json`)
      expect(paths).toContain(`${folder}/.codex-plugin/plugin.json`)
    }
    expect(paths).not.toContain('people/.claude-plugin/plugin.json')

    const codexPlugin = JSON.parse(
      files.find((f) => f.path === 'field/.codex-plugin/plugin.json')!.content,
    )
    expect(codexPlugin.skills).toBe('./skills/')
  })

  it('uses Codex-specific schema fields', () => {
    const files = generateMarketplaceFiles(ALL)
    const codex = JSON.parse(files.find((f) => f.path === '.agents/plugins/marketplace.json')!.content)

    expect(codex.interface.displayName).toBe(skillsConfig.marketplace.displayName)
    expect(codex.plugins[0].policy.installation).toBe('AVAILABLE')
    expect(codex.plugins[0].policy.authentication).toBe('ON_INSTALL')
    expect(codex.plugins[0].category).toBe('Productivity')
    expect(codex.plugins[0].source).toEqual({source: 'local', path: './field'})
  })

  it('every generated file ends with a newline', () => {
    for (const file of generateMarketplaceFiles(ALL)) {
      expect(file.content.endsWith('\n')).toBe(true)
    }
  })
})

describe('resolveSyncAudiences', () => {
  const routeTo = (skillAudiences: Audience[], skillName = 'web-analytics') =>
    resolveSyncAudiences({skillName, skillAudiences, allAudiences: ALL})

  it('keeps hiding audiences no skill is routed to', () => {
    const resolved = routeTo([FIELD])
    const shared = JSON.parse(
      generateMarketplaceFiles(resolved).find(
        (f) => f.path === '.claude-plugin/marketplace.json',
      )!.content,
    )

    expect(shared.plugins.map((p: any) => p.name)).toEqual([
      'field',
      'marketing',
      EVERYONE_FOLDER,
    ])
  })

  it('covers an audience with routed skills that a zero skillCount would have skipped', () => {
    // The divergence: file routing writes people/skills/web-analytics/ because
    // the skill references the People audience, while manifest generation
    // dropped People for having no counted skills — an orphan folder with no
    // plugin.json, no marketplace entry and no overview.
    const resolved = routeTo([ROUTED_EMPTY])
    const files = generateMarketplaceFiles(resolved)
    const paths = files.map((f) => f.path)
    const shared = JSON.parse(
      files.find((f) => f.path === '.claude-plugin/marketplace.json')!.content,
    )
    const codex = JSON.parse(
      files.find((f) => f.path === '.agents/plugins/marketplace.json')!.content,
    )

    expect(shared.plugins.map((p: any) => p.name)).toContain('people')
    expect(codex.plugins.map((p: any) => p.name)).toContain('people')
    expect(paths).toContain('people/.claude-plugin/plugin.json')
    expect(paths).toContain('people/.codex-plugin/plugin.json')

    const overview = generateOverviewSkills(resolved, [
      {skillName: 'web-analytics', description: 'Analytics.', folders: [{folder: 'people'}]},
    ]).find((f) => f.path === 'people/skills/people-overview/SKILL.md')!
    expect(overview.content).toContain('`web-analytics`')
  })

  it('skips the overview for a folder the skill index has no skills for', () => {
    // A stale skill-index read would otherwise ship a "directory of every
    // skill" that lists none. The plugin still installs; the next sync fills
    // the catalog in.
    const files = generateOverviewSkills(routeTo([ROUTED_EMPTY]), [])

    expect(files.map((f) => f.path)).not.toContain('people/skills/people-overview/SKILL.md')
  })

  it('prefers the audience document over the per-skill projection, keeping overviewNotes', () => {
    const routed: Audience = {...MARKETING, overviewNotes: undefined, skillCount: undefined}
    const marketing = generateOverviewSkills(routeTo([routed]), [
      {skillName: 'ad-writing', description: 'Write ads.', folders: [{folder: 'marketing'}]},
    ]).find((f) => f.path.startsWith('marketing/'))!

    expect(marketing.content).toContain('## Team conventions')
  })

  it('does not disturb the audiences a sync is not routing into', () => {
    expect(routeTo([ROUTED_EMPTY]).filter((a) => pluginFolder(a) !== 'people')).toEqual(
      ALL.filter((a) => pluginFolder(a) !== 'people'),
    )
  })

  it('errors, naming the skill and the audience, when no audience document matches', () => {
    expect(() => routeTo([UNPUBLISHED], 'marketing-web-analytics')).toThrow(
      /marketing-web-analytics/,
    )
    expect(() => routeTo([UNPUBLISHED], 'marketing-web-analytics')).toThrow(/"Beta"/)
    expect(() => routeTo([UNPUBLISHED], 'marketing-web-analytics')).toThrow(/"beta"/)
  })

  it('errors when a routed audience has no plugin folder to write into', () => {
    // A draft audience document can be routed to before its (required) slug
    // is filled in — the query type says `string`, the dataset can disagree.
    const folderless: Audience = {...UNPUBLISHED, slug: '', pluginName: null}

    expect(() => routeTo([folderless])).toThrow(/no plugin folder/)
    expect(() => routeTo([folderless])).toThrow(/"Beta"/)
  })
})

describe('computeSkillTreeChanges', () => {
  const relativeFiles = [
    {relPath: 'SKILL.md', content: 'skill body\n'},
    {relPath: 'references/how-to.md', content: 'ref\n'},
  ]

  it('writes the skill into every audience folder', () => {
    const {writes} = computeSkillTreeChanges({
      skillName: 'billing-lookup',
      relativeFiles,
      skillAudiences: [FIELD, MARKETING],
      allAudiences: ALL,
      existingPaths: [],
    })

    const paths = writes.map((w) => w.path)
    expect(paths).toContain('field/skills/billing-lookup/SKILL.md')
    expect(paths).toContain('field/skills/billing-lookup/references/how-to.md')
    expect(paths).toContain('marketing/skills/billing-lookup/SKILL.md')
    expect(paths).toHaveLength(4)
  })

  it('deletes managed files from folders the skill left', () => {
    const {deletions} = computeSkillTreeChanges({
      skillName: 'billing-lookup',
      relativeFiles,
      skillAudiences: [FIELD],
      allAudiences: ALL,
      existingPaths: [
        'marketing/skills/billing-lookup/SKILL.md',
        'marketing/skills/billing-lookup/references/how-to.md',
        'field/skills/billing-lookup/SKILL.md',
      ],
    })

    expect(deletions).toEqual([
      'marketing/skills/billing-lookup/SKILL.md',
      'marketing/skills/billing-lookup/references/how-to.md',
    ])
  })

  it('deletes stale references in folders the skill keeps', () => {
    const {deletions} = computeSkillTreeChanges({
      skillName: 'billing-lookup',
      relativeFiles: [{relPath: 'SKILL.md', content: 'skill body\n'}],
      skillAudiences: [FIELD],
      allAudiences: ALL,
      existingPaths: ['field/skills/billing-lookup/references/removed.md'],
    })

    expect(deletions).toEqual(['field/skills/billing-lookup/references/removed.md'])
  })

  it('never touches unmanaged files (evals, scripts, logs) or other skills', () => {
    const {deletions} = computeSkillTreeChanges({
      skillName: 'starter-kit-accelerator',
      relativeFiles,
      skillAudiences: [FIELD],
      allAudiences: ALL,
      existingPaths: [
        'field/skills/starter-kit-accelerator/evals/evals.json',
        'field/skills/starter-kit-accelerator/AUTHORING-LOG.md',
        'field/skills/starter-kit-accelerator-two/SKILL.md',
        'rnd/skills/repo-native-skill/SKILL.md',
      ],
    })

    expect(deletions).toEqual([])
  })
})

describe('generateOverviewSkills', () => {
  const INDEX = [
    {skillName: 'style-guide', description: 'House style rules. More detail here.', folders: [{folder: EVERYONE_FOLDER}]},
    {skillName: 'billing-lookup', description: 'Look up billing data for customers.', folders: [{folder: 'field'}, {folder: 'marketing'}]},
    {skillName: 'ad-writing', description: 'Write ads.', folders: [{folder: 'marketing'}]},
  ]

  it('generates one overview per active plugin, at an unmanaged-safe path', () => {
    const files = generateOverviewSkills(ALL, INDEX)
    const paths = files.map((f) => f.path)

    expect(paths).toContain(`${EVERYONE_FOLDER}/skills/${EVERYONE_FOLDER}-overview/SKILL.md`)
    expect(paths).toContain('field/skills/field-overview/SKILL.md')
    expect(paths).toContain('marketing/skills/marketing-overview/SKILL.md')
    expect(paths.some((p) => p.startsWith('people/'))).toBe(false)
  })

  it('frontmatter has a trigger-rich description with the plugin domain nouns, and no version', () => {
    const field = generateOverviewSkills(ALL, INDEX).find((f) => f.path.startsWith('field/'))!

    expect(field.content).toContain('name: field-overview')
    expect(field.content).toContain('what skills do we have')
    expect(field.content).toContain('Field organization')
    expect(field.content).not.toContain('version:')
  })

  it('lists own skills by bare name with first-sentence descriptions, and states both invocation forms once', () => {
    const field = generateOverviewSkills(ALL, INDEX).find((f) => f.path.startsWith('field/'))!

    expect(field.content).toContain('`billing-lookup` — Look up billing data for customers.')
    expect(field.content).toContain('`/field:billing-lookup`')
    expect(field.content).not.toContain('`ad-writing`')
  })

  it('org-wide overview is the full catalog with install hints for other plugins', () => {
    const everyone = generateOverviewSkills(ALL, INDEX).find((f) =>
      f.path.startsWith(`${EVERYONE_FOLDER}/`),
    )!

    expect(everyone.content).toContain('`style-guide`')
    expect(everyone.content).toContain(`claude plugin install field@${MARKETPLACE}`)
    expect(everyone.content).toContain('`ad-writing`')
    expect(everyone.content).toContain('Org-wide skills')
  })

  it('appends overviewNotes after the skill list, before the closing instruction', () => {
    const marketing = generateOverviewSkills(ALL, INDEX).find((f) => f.path.startsWith('marketing/'))!
    const field = generateOverviewSkills(ALL, INDEX).find((f) => f.path.startsWith('field/'))!

    expect(marketing.content).toContain('## Team conventions')
    expect(marketing.content.indexOf('`ad-writing`')).toBeLessThan(
      marketing.content.indexOf('## Team conventions'),
    )
    expect(marketing.content.indexOf('## Team conventions')).toBeLessThan(
      marketing.content.indexOf('Pick the skill that matches'),
    )
    expect(field.content).not.toContain('## Team conventions')
  })

  it('uses only the first sentence of multi-sentence descriptions', () => {
    const everyone = generateOverviewSkills(ALL, INDEX).find((f) =>
      f.path.startsWith(`${EVERYONE_FOLDER}/`),
    )!

    expect(everyone.content).toContain('House style rules.')
    expect(everyone.content).not.toContain('More detail here.')
  })
})
