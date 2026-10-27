/**
 * The Studio's "Who can invoke this skill?" setting, mapped to Claude Code's
 * invocation keys (https://code.claude.com/docs/en/skills#control-who-invokes-a-skill).
 * The default mode emits nothing, so skills that never set it are unchanged.
 */
export type SkillInvocation = {
  mode?: 'default' | 'userOnly' | 'modelOnly' | null
  argumentHint?: string | null
} | null

function invocationFrontmatter(invocation: SkillInvocation | undefined): string {
  const mode = invocation?.mode
  let out = ''
  if (mode === 'userOnly') out += '\ndisable-model-invocation: true'
  if (mode === 'modelOnly') out += '\nuser-invocable: false'
  // Hints look like `[ticket-url]`, which bare YAML reads as a list: quote it.
  const hint = invocation?.argumentHint?.trim()
  if (hint && mode !== 'modelOnly') out += `\nargument-hint: ${JSON.stringify(hint)}`
  return out
}

export function assembleSkillMd(skill: {
  skillName: string
  description: string
  content: string
  metadata?: {
    tags?: string[] | null
    visibility?: string | null
    owner?: string | null
    owners?: Array<{name?: string | null; email?: string | null} | null> | null
  } | null
  invocation?: SkillInvocation
}): string {
  const cleanDesc = skill.description.trim().replace(/\n\s*/g, ' ')
  const descLines = cleanDesc
    .split('\n')
    .map((line: string) => `  ${line}`)
    .join('\n')

  const version = new Date().toISOString().slice(0, 10)

  let frontmatter = `---\nname: ${skill.skillName}\ndescription: >\n${descLines}\nversion: ${version}`
  frontmatter += invocationFrontmatter(skill.invocation)

  if (skill.metadata?.tags?.length) {
    frontmatter += `\ntags:\n${skill.metadata.tags.map((t) => `  - ${t}`).join('\n')}`
  }

  if (skill.metadata?.visibility) {
    frontmatter += `\nvisibility: ${skill.metadata.visibility}`
  }

  const owners = (skill.metadata?.owners || [])
    .filter((o): o is {name?: string | null; email?: string | null} => !!o && !!(o.name || o.email))
    .map((o) => (o.name && o.email ? `${o.name} <${o.email}>` : o.name || o.email))
  if (owners.length) {
    frontmatter += `\nowner: ${owners.join(', ')}`
  } else if (skill.metadata?.owner) {
    frontmatter += `\nowner: ${skill.metadata.owner}`
  }

  frontmatter += `\n---`

  return `${frontmatter}\n\n${skill.content}\n`
}

/**
 * Get the on-disk path for a skill reference file.
 *
 * Accepts either a plain string (current schema) or a Sanity slug object
 * (`{_type: 'slug', current: 'foo'}`) — legacy data shape that survives
 * in the dataset until the doc is re-saved. Without this fallback, the
 * publish-to-GitHub action throws on `.includes()` and the sync fails
 * silently from the user's perspective.
 */
export function getRefFilePath(filename: string | {current?: string} | null | undefined): string {
  const name =
    typeof filename === 'string'
      ? filename
      : filename && typeof filename === 'object' && typeof filename.current === 'string'
        ? filename.current
        : ''
  if (!name) {
    throw new Error(
      'Skill reference is missing a filename. Open the reference in Studio and set the Filename field.',
    )
  }
  return name.includes('.') ? name : `${name}.md`
}

/**
 * Assemble a skill's files relative to its skill folder. Audience routing
 * (utils/audiences.ts) multiplies these across the skill's plugin folders.
 */
export function assembleSkillRelativeFiles(skill: {
  skillName: string
  description: string
  content: string
  metadata?: {
    tags?: string[] | null
    visibility?: string | null
    owner?: string | null
    owners?: Array<{name?: string | null; email?: string | null} | null> | null
  } | null
  invocation?: SkillInvocation
  references?: Array<{filename: string | {current?: string}; content: string} | null> | null
}): Array<{relPath: string; content: string}> {
  const files = [{relPath: 'SKILL.md', content: assembleSkillMd(skill)}]
  for (const ref of skill.references || []) {
    if (!ref) continue
    files.push({
      relPath: `references/${getRefFilePath(ref.filename)}`,
      content: ref.content + '\n',
    })
  }
  return files
}
