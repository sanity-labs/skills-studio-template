/**
 * Audience → plugin routing for the GitHub sync.
 *
 * Each `audience` document maps 1:1 to a plugin folder in this repo:
 * `<folder>/skills/<skillName>/…`, where folder = pluginName ?? slug.
 * The Everyone audience overrides pluginName to `everyonePluginName` from
 * skills.config.ts.
 *
 * Marketplace manifests are regenerated from the audience documents on
 * every sync. Plugin versions are intentionally omitted: without a version
 * field every git commit counts as a new version, and a plugin.json version
 * would silently override the marketplace entry.
 *
 * The sync only manages `SKILL.md` and flat `references/*` inside a skill
 * folder — extra files kept in the repo (evals/, scripts/, authoring logs)
 * are never written or deleted, so repo-native skills (maintained directly
 * in git) are left alone.
 *
 * Used by the publish-to-github and delete-from-github Functions and the
 * publishToGitHub document action.
 */
import {defineQuery} from 'groq'
import {REPO_URL} from './constants'
import {skillsConfig} from '../skills.config'
import type {ALL_AUDIENCES_QUERY_RESULT} from '../sanity.types'

const MARKETPLACE_NAME = skillsConfig.marketplace.name
const MARKETPLACE_DESCRIPTION = skillsConfig.marketplace.description
const AUTHOR = {
  name: skillsConfig.marketplace.author.name,
  email: skillsConfig.marketplace.author.email,
}

/** GROQ: all published audiences with their published-skill counts. */
export const ALL_AUDIENCES_QUERY = defineQuery(`*[_type == "audience" && !(_id in path("drafts.**"))]{
  "slug": slug.current, title, pluginTitle, pluginDescription, autoInstall, pluginName, overviewNotes,
  "skillCount": count(*[_type == "skill" && !(_id in path("drafts.**")) && references(^._id)])
}`)

/**
 * Typegen-derived audience shape. `skillCount` is optional because the
 * per-skill audience projections (and the Function's event projection,
 * which typegen doesn't cover) omit it.
 */
export type Audience = Omit<ALL_AUDIENCES_QUERY_RESULT[number], 'skillCount' | 'overviewNotes'> & {
  skillCount?: number | null
  overviewNotes?: string | null
}

/** GROQ projection fragment for a skill's dereferenced audiences. */
export const AUDIENCES_PROJECTION = `audiences[]->{
  "slug": slug.current, title, pluginTitle, pluginDescription, autoInstall, pluginName
}`

export function pluginFolder(audience: Audience): string {
  return audience.pluginName || audience.slug
}

/** UI label for the plugin — install name (pluginFolder) stays unchanged. */
export function pluginDisplayName(audience: Audience): string {
  return audience.pluginTitle || audience.title
}

function jsonFile(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

function activeAudiences(all: Audience[]): Audience[] {
  return all
    .filter((a) => (a.skillCount ?? 0) > 0)
    .sort((a, b) => pluginFolder(a).localeCompare(pluginFolder(b)))
}

function audienceLabel(audience: Audience): string {
  return audience.title || audience.slug || '(untitled audience)'
}

/**
 * The audience set a sync generates manifests, plugin.json files and overview
 * skills from: every audience document, with the audiences this sync is
 * actually routing files into guaranteed to be in it.
 *
 * Without this, two code paths resolved audiences independently and could
 * disagree. File routing (`computeSkillTreeChanges`) writes a skill into
 * `pluginFolder()` for every audience on the skill document. Manifest and
 * overview generation read the audience documents and drop anything with no
 * published skills. When routing sees an audience that the manifest side
 * doesn't, the skill folder is committed with no `plugin.json`, no entry in
 * any marketplace manifest and no overview — an uninstallable orphan folder,
 * with nothing in the logs to say so.
 *
 * Making the routed audiences the source of truth for both closes that gap:
 *
 *  - An audience this sync writes into always appears in the manifests, even
 *    if the `skillCount` read lagged the publish that triggered the sync.
 *  - An audience the manifest side cannot resolve at all (no matching
 *    audience document, or no folder name to write under) is a hard error
 *    naming the skill and the audience, thrown before anything is committed.
 *
 * The `skillCount > 0` filter is kept, so audiences nothing is routed to stay
 * out of the marketplace; it just can no longer hide an audience that a skill
 * is being published into.
 */
export function resolveSyncAudiences(options: {
  skillName: string
  skillAudiences: Audience[]
  allAudiences: Audience[]
}): Audience[] {
  const {skillName, skillAudiences, allAudiences} = options

  const byFolder = new Map<string, Audience>()
  for (const audience of allAudiences) {
    const folder = pluginFolder(audience)
    if (folder) byFolder.set(folder, audience)
  }

  const resolved = new Map(byFolder)
  for (const routed of skillAudiences) {
    const folder = pluginFolder(routed)
    if (!folder) {
      throw new Error(
        `Skill "${skillName}" is routed to the audience "${audienceLabel(routed)}", which has no ` +
          `plugin folder to write into. Give that audience document a slug (or a pluginName) in ` +
          `the Studio, then re-publish this skill. Nothing was written to GitHub.`,
      )
    }
    const known = byFolder.get(folder)
    if (!known) {
      throw new Error(
        `Skill "${skillName}" is routed to the audience "${audienceLabel(routed)}" (plugin folder ` +
          `"${folder}"), but no published audience document matches it, so the marketplace ` +
          `manifests and "${folder}/.claude-plugin/plugin.json" cannot be generated. Publishing ` +
          `would leave "${folder}/skills/${skillName}/" in the repo as an uninstallable orphan, ` +
          `so nothing was written to GitHub. Publish the "${audienceLabel(routed)}" audience ` +
          `document in the Studio, then re-publish this skill.`,
      )
    }
    // The routing decision is the truth about which folders this sync writes.
    // A skillCount of 0 here means the count read lagged the publish that
    // triggered the sync, not that the folder is empty.
    resolved.set(folder, {...known, skillCount: Math.max(known.skillCount ?? 0, 1)})
  }

  return [...resolved.values()]
}

/** Shared schema: Claude Code, Cursor 2.5, GitHub Copilot. */
function buildSharedMarketplaceJson(audiences: Audience[]): string {
  return jsonFile({
    name: MARKETPLACE_NAME,
    owner: {...AUTHOR, url: skillsConfig.marketplace.author.url},
    metadata: {description: MARKETPLACE_DESCRIPTION},
    plugins: audiences.map((a) => ({
      name: pluginFolder(a),
      displayName: pluginDisplayName(a),
      source: `./${pluginFolder(a)}`,
      description: a.pluginDescription,
      repository: REPO_URL,
      author: AUTHOR,
    })),
  })
}

/** Codex schema: object source, policy, category, displayName. */
function buildCodexMarketplaceJson(audiences: Audience[]): string {
  return jsonFile({
    name: MARKETPLACE_NAME,
    interface: {displayName: skillsConfig.marketplace.displayName},
    metadata: {description: MARKETPLACE_DESCRIPTION},
    plugins: audiences.map((a) => ({
      name: pluginFolder(a),
      source: {source: 'local', path: `./${pluginFolder(a)}`},
      description: a.pluginDescription,
      repository: REPO_URL,
      author: AUTHOR,
      policy: {installation: 'AVAILABLE', authentication: 'ON_INSTALL'},
      category: 'Productivity',
    })),
  })
}

function buildClaudePluginJson(a: Audience): string {
  return jsonFile({
    name: pluginFolder(a),
    displayName: pluginDisplayName(a),
    description: a.pluginDescription,
    author: AUTHOR,
    repository: REPO_URL,
  })
}

function buildCodexPluginJson(a: Audience): string {
  return jsonFile({
    name: pluginFolder(a),
    description: a.pluginDescription,
    author: AUTHOR,
    repository: REPO_URL,
    skills: './skills/',
  })
}

/**
 * Marketplace manifests (4 platforms) plus per-plugin plugin.json files,
 * regenerated from the audience set the caller was handed by
 * `resolveSyncAudiences`. Only audiences with at least one published skill
 * appear — plus whichever audiences the current sync is routing into.
 */
export function generateMarketplaceFiles(
  syncAudiences: Audience[],
): Array<{path: string; content: string}> {
  const active = activeAudiences(syncAudiences)
  const shared = buildSharedMarketplaceJson(active)
  const codex = buildCodexMarketplaceJson(active)
  const files: Array<{path: string; content: string}> = [
    {path: '.claude-plugin/marketplace.json', content: shared},
    {path: '.cursor-plugin/marketplace.json', content: shared},
    {path: '.github/plugin/marketplace.json', content: shared},
    {path: '.agents/plugins/marketplace.json', content: codex},
  ]
  for (const a of active) {
    const folder = pluginFolder(a)
    files.push({path: `${folder}/.claude-plugin/plugin.json`, content: buildClaudePluginJson(a)})
    files.push({path: `${folder}/.codex-plugin/plugin.json`, content: buildCodexPluginJson(a)})
  }
  return files
}

/** GROQ: every published skill with its plugin folders, for overview generation. */
export const SKILL_INDEX_QUERY = defineQuery(`*[_type == "skill" && !(_id in path("drafts.**"))] | order(skillName asc) {
  skillName, description,
  "folders": audiences[]->{"folder": coalesce(pluginName, slug.current)}
}`)

export type SkillIndexEntry = {
  skillName: string
  description: string
  folders?: Array<{folder: string | null} | null> | null
}

const EVERYONE_FOLDER: string = skillsConfig.everyonePluginName

function firstSentence(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  const match = clean.match(/^.*?[.!?](\s|$)/)
  return (match ? match[0] : clean).trim()
}

function overviewDescription(audience: Audience): string {
  const name = pluginDisplayName(audience)
  // Domain nouns from the plugin description make discovery questions like
  // "what sales skills do we have" land here semantically.
  const domain = audience.pluginDescription.trim().replace(/\.$/, '')
  return (
    `Directory of every skill in the ${name} plugin. ${domain}. ` +
    `Use when asking what skills are available, whether a skill exists for a task, ` +
    `which skill to use, or what ${skillsConfig.orgName} has skills for. ` +
    `Triggers on: "what skills do we have", "is there a skill for", ` +
    `"which skill should I use", "list skills", "browse skills".`
  )
}

// No version field: the overview should only change when the catalog does,
// not on every sync day.
function overviewSkillMd(name: string, description: string, body: string): string {
  const descLines = description
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  return `---\nname: ${name}\ndescription: >\n${descLines}\n---\n\n${body}\n`
}

function skillLine(skill: SkillIndexEntry): string {
  return `- \`${skill.skillName}\` — ${firstSentence(skill.description)}`
}

/**
 * One generated `<folder>-overview` skill per plugin in the audience set the
 * caller was handed by `resolveSyncAudiences`, listing its
 * skills so agents can answer "what skills are there for X?". The org-wide
 * plugin's overview is the full catalog: it also lists every other plugin's
 * skills with install hints, so cross-plugin discovery works for people who
 * only have the auto-installed plugin. Regenerated on every sync. A folder
 * with no skills in `skillIndex` is skipped rather than given an empty
 * catalog.
 */
export function generateOverviewSkills(
  syncAudiences: Audience[],
  skillIndex: SkillIndexEntry[],
): Array<{path: string; content: string}> {
  const active = activeAudiences(syncAudiences)
  const skillsIn = (folder: string) =>
    skillIndex.filter((s) => (s.folders || []).some((f) => f?.folder === folder))

  return active.flatMap((audience) => {
    const folder = pluginFolder(audience)
    const name = `${folder}-overview`
    const own = skillsIn(folder)

    // Nothing indexed for this folder yet — a skill-index read that lagged the
    // publish driving this sync. Writing the overview now would ship a catalog
    // that lists no skills at all; leave any existing file alone and let the
    // next sync fill it in.
    if (own.length === 0) return []

    const sections: string[] = [
      `# ${pluginDisplayName(audience)} — skill directory`,
      '',
      `Skills in this plugin. In the Claude apps, invoke one by name (e.g. \`/${own[0]?.skillName || 'skill-name'}\`) or just describe the task; in Claude Code, plugin skills are namespaced (e.g. \`/${folder}:${own[0]?.skillName || 'skill-name'}\`).`,
      '',
      ...own.map((s) => skillLine(s)),
    ]

    if (folder === EVERYONE_FOLDER) {
      for (const other of active) {
        const otherFolder = pluginFolder(other)
        if (otherFolder === folder) continue
        sections.push(
          '',
          `## ${pluginDisplayName(other)} plugin (not installed by default)`,
          '',
          `${other.pluginDescription.trim()} Install: \`claude plugin install ${otherFolder}@${MARKETPLACE_NAME}\``,
          '',
          ...skillsIn(otherFolder).map((s) => skillLine(s)),
        )
      }
    }

    if (audience.overviewNotes?.trim()) {
      sections.push('', audience.overviewNotes.trim())
    }

    sections.push(
      '',
      'Pick the skill that matches the task and follow it. If none match, say which skills come closest and where the gap is.',
    )

    return [
      {
        path: `${folder}/skills/${name}/SKILL.md`,
        content: overviewSkillMd(name, overviewDescription(audience), sections.join('\n')),
      },
    ]
  })
}

/** True for the paths the sync owns inside a skill folder. */
function isManagedSkillPath(relPath: string): boolean {
  return relPath === 'SKILL.md' || /^references\/[^/]+$/.test(relPath)
}

/**
 * Given the files a skill assembles to (relative to its folder), compute the
 * absolute writes across all its audience plugin folders, and the deletions
 * of managed files from folders the skill no longer belongs to (or stale
 * references in folders it keeps). `existingPaths` is the full recursive
 * blob list of the base tree.
 */
export function computeSkillTreeChanges(options: {
  skillName: string
  relativeFiles: Array<{relPath: string; content: string}>
  skillAudiences: Audience[]
  allAudiences: Audience[]
  existingPaths: string[]
}): {writes: Array<{path: string; content: string}>; deletions: string[]} {
  const {skillName, relativeFiles, skillAudiences, allAudiences, existingPaths} = options

  const writes = new Map<string, string>()
  const skillFolders = new Set(skillAudiences.map(pluginFolder))
  for (const folder of skillFolders) {
    for (const file of relativeFiles) {
      writes.set(`${folder}/skills/${skillName}/${file.relPath}`, file.content)
    }
  }

  const deletions: string[] = []
  const allFolders = new Set(allAudiences.map(pluginFolder))
  for (const path of existingPaths) {
    for (const folder of allFolders) {
      const skillRoot = `${folder}/skills/${skillName}/`
      if (!path.startsWith(skillRoot)) continue
      const relPath = path.slice(skillRoot.length)
      if (isManagedSkillPath(relPath) && !writes.has(path)) deletions.push(path)
      break
    }
  }

  return {
    writes: [...writes.entries()].map(([path, content]) => ({path, content})),
    deletions,
  }
}
