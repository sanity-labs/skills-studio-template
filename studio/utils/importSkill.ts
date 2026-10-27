/**
 * GitHub → Studio: turn a skill folder that arrived through a pull request
 * into the fields of a `skill` document, and check that a Studio publish
 * would write the same files back.
 *
 * Pure functions only; `scripts/import-skill-from-repo.ts` does the I/O.
 * The mapping is the inverse of `assembleSkillMd` in `utils/assemble.ts`,
 * so a skill written to match that format round-trips byte for byte, apart
 * from the `version:` line, which every publish restamps.
 */
import {parse as parseYaml} from 'yaml'
import {assembleSkillRelativeFiles, type SkillInvocation} from './assemble'

export type RepoSkillFile = {relPath: string; content: string}

export type ImportedOwner = {name?: string; email?: string}

export type ParsedRepoSkill = {
  skillName: string
  title?: string
  description: string
  content: string
  tags: string[]
  visibility?: 'shareable' | 'confidential'
  owners: ImportedOwner[]
  invocation?: NonNullable<SkillInvocation>
  references: Array<{filename: string; content: string}>
  /** Files the sync doesn't manage (evals/, scripts/ …). They stay in the repo, untouched. */
  unmanaged: string[]
  /** Stop: importing would lose or break something. */
  problems: string[]
  /** Metadata to fill in on the Studio draft before publishing. */
  missing: string[]
}

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const REF_FILENAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z]+)?$/
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
// Keys assembleSkillMd writes. Anything else has no Studio field and would be dropped on publish.
const KNOWN_KEYS = new Set([
  'name',
  'description',
  'version',
  'tags',
  'visibility',
  'owner',
  'disable-model-invocation',
  'user-invocable',
  'argument-hint',
])

function stripOneTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/** `Name <email>, Name2 <email2>` — the format assembleSkillMd writes for owners. */
export function parseOwners(value: unknown): ImportedOwner[] {
  const entries = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',') : []
  return entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*?)\s*<([^>]+)>$/)
      if (match) return {name: match[1].trim() || undefined, email: match[2].trim()}
      return entry.includes('@') ? {email: entry} : {name: entry}
    })
}

/** Order references by first mention in the body, then by name — Studio order is what agents see. */
function orderReferences<T extends {filename: string; relPath: string}>(refs: T[], body: string): T[] {
  const position = (ref: T) => {
    const index = body.indexOf(ref.relPath)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return [...refs].sort((a, b) => position(a) - position(b) || a.filename.localeCompare(b.filename))
}

export function parseRepoSkill(dirName: string, files: RepoSkillFile[]): ParsedRepoSkill {
  const problems: string[] = []
  const missing: string[] = []
  const unmanaged: string[] = []

  const skillMd = files.find((f) => f.relPath === 'SKILL.md')
  if (!skillMd) {
    return {
      skillName: dirName,
      description: '',
      content: '',
      tags: [],
      owners: [],
      references: [],
      unmanaged,
      problems: ['No SKILL.md in the skill folder'],
      missing,
    }
  }

  const match = skillMd.content.match(FRONTMATTER_PATTERN)
  let frontmatter: Record<string, unknown> = {}
  if (!match) {
    problems.push('SKILL.md has no YAML frontmatter (--- … ---)')
  } else {
    try {
      const parsed = parseYaml(match[1])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>
      } else {
        problems.push('SKILL.md frontmatter is not a YAML mapping')
      }
    } catch (err) {
      problems.push(`SKILL.md frontmatter is not valid YAML: ${(err as Error).message}`)
    }
  }
  const body = match ? skillMd.content.slice(match[0].length) : skillMd.content

  const skillName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
  if (!skillName) problems.push('Frontmatter has no `name`')
  else {
    if (skillName !== dirName) problems.push(`\`name: ${skillName}\` must match the folder name \`${dirName}\``)
    if (!NAME_PATTERN.test(skillName) || skillName.length > 64)
      problems.push(`\`name: ${skillName}\` must be lowercase a-z0-9 and hyphens, at most 64 characters`)
    if (skillName.endsWith('-overview')) problems.push('Names ending in `-overview` are reserved for generated skills')
  }

  const description =
    typeof frontmatter.description === 'string' ? frontmatter.description.trim().replace(/\s*\n\s*/g, ' ') : ''
  if (!description) problems.push('Frontmatter has no `description`')
  else if (description.length > 1024)
    problems.push(`\`description\` is ${description.length} characters; the limit is 1024`)

  const dropped = Object.keys(frontmatter).filter((key) => !KNOWN_KEYS.has(key))
  if (dropped.length)
    problems.push(`Frontmatter keys with no Studio field would be dropped on publish: ${dropped.join(', ')}`)

  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map((t) => String(t).trim()).filter(Boolean) : []
  if (!tags.length) missing.push('tags')

  let visibility: ParsedRepoSkill['visibility']
  if (frontmatter.visibility === 'shareable' || frontmatter.visibility === 'confidential') {
    visibility = frontmatter.visibility
  } else if (frontmatter.visibility !== undefined) {
    problems.push(`\`visibility: ${String(frontmatter.visibility)}\` must be shareable or confidential`)
  } else {
    missing.push('visibility')
  }

  const owners = parseOwners(frontmatter.owner)
  if (!owners.length) missing.push('owners')

  const userOnly = frontmatter['disable-model-invocation'] === true
  const modelOnly = frontmatter['user-invocable'] === false
  if (userOnly && modelOnly)
    problems.push('`disable-model-invocation: true` and `user-invocable: false` together leave nobody able to invoke it')
  const argumentHint =
    typeof frontmatter['argument-hint'] === 'string' ? frontmatter['argument-hint'].trim() : undefined
  const mode = userOnly ? ('userOnly' as const) : modelOnly ? ('modelOnly' as const) : ('default' as const)
  const invocation = mode !== 'default' || argumentHint ? {mode, ...(argumentHint ? {argumentHint} : {})} : undefined

  const refFiles: Array<{filename: string; relPath: string; content: string}> = []
  for (const file of files) {
    if (file.relPath === 'SKILL.md') continue
    const refMatch = file.relPath.match(/^references\/([^/]+)$/)
    if (!refMatch) {
      if (file.relPath.startsWith('references/'))
        problems.push(`${file.relPath}: the Studio only holds flat references/<file>, not subfolders`)
      else unmanaged.push(file.relPath)
      continue
    }
    const filename = refMatch[1].replace(/\.md$/, '')
    if (!REF_FILENAME_PATTERN.test(filename)) {
      problems.push(`${file.relPath}: reference filenames must match ${REF_FILENAME_PATTERN}`)
      continue
    }
    refFiles.push({filename, relPath: file.relPath, content: stripOneTrailingNewline(file.content)})
  }

  const content = stripOneTrailingNewline(body.replace(/^(\r?\n)+/, ''))
  if (!content.trim()) problems.push('SKILL.md has no body')
  const title = content.match(/^# (.+)$/m)?.[1].trim()

  return {
    skillName: skillName || dirName,
    title,
    description,
    content,
    tags,
    visibility,
    owners,
    invocation,
    references: orderReferences(refFiles, body).map(({filename, content}) => ({filename, content})),
    unmanaged,
    problems,
    missing,
  }
}

const withoutVersionLine = (text: string) => text.replace(/^version: .*\r?\n/m, '')

export type RoundTripDiff = {relPath: string; line: number; repo?: string; studio?: string}

/**
 * Managed files a Studio publish of `parsed` would write differently from the
 * repo, with the first line that changes. Empty means the publish is a no-op
 * apart from the `version:` stamp. Past `parsed.problems`, a difference is
 * formatting (YAML style, blank lines), not lost content.
 */
export function roundTripDiffs(parsed: ParsedRepoSkill, files: RepoSkillFile[]): RoundTripDiff[] {
  const assembled = assembleSkillRelativeFiles({
    skillName: parsed.skillName,
    description: parsed.description,
    content: parsed.content,
    metadata: {tags: parsed.tags, visibility: parsed.visibility, owners: parsed.owners},
    invocation: parsed.invocation,
    references: parsed.references,
  })
  const repo = new Map(files.map((f) => [f.relPath, f.content]))
  return assembled.flatMap(({relPath, content}) => {
    const current = repo.get(relPath)
    if (current === undefined) return [{relPath, line: 1, studio: content.split('\n')[0]}]
    const a = withoutVersionLine(current).split('\n')
    const b = withoutVersionLine(content).split('\n')
    const index = Array.from({length: Math.max(a.length, b.length)}).findIndex((_, i) => a[i] !== b[i])
    return index === -1 ? [] : [{relPath, line: index + 1, repo: a[index], studio: b[index]}]
  })
}
