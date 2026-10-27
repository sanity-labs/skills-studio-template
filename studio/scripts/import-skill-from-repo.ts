/**
 * Import a skill that arrived through a GitHub pull request into the Studio,
 * so the Studio becomes its source of truth.
 *
 * Reads `<pluginFolder>/skills/<name>/` from a checkout, maps the frontmatter
 * onto the skill schema (owners matched against the org directory, audiences
 * from the plugin folders the skill sits in), and checks that a Studio
 * publish would write the same files back.
 *
 * With APPLY=1 it creates the reference files (published, so the skill can
 * point at them) and the skill itself as a DRAFT. Open the draft in the
 * Studio, fill in anything reported as missing, run "Compare with other
 * skills", and publish there: that runs the Studio's checks and triggers the
 * GitHub sync. Published references with no published parent skill don't
 * sync anything on their own.
 *
 * Merge the PR before you publish the draft. A publish commits the skill to
 * main, and if that lands first the PR conflicts with it.
 *
 * Dry run (default) prints the plan. APPLY=1 writes.
 *
 *   cd studio
 *   npx sanity exec scripts/import-skill-from-repo.ts --with-user-token -- ../<plugin>/skills/<name>
 *   APPLY=1 npx sanity exec scripts/import-skill-from-repo.ts --with-user-token -- ../<plugin>/skills/<name>
 */
import {readdirSync, readFileSync, lstatSync, existsSync} from 'node:fs'
import {basename, dirname, join, relative, resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {getCliClient} from 'sanity/cli'
import {parseRepoSkill, roundTripDiffs, type RepoSkillFile} from '../utils/importSkill'

const apply = process.env.APPLY === '1'
const target = process.env.SKILL_DIR || process.argv.slice(2).filter((arg) => !arg.startsWith('-')).pop()
if (!target) {
  console.error('Pass the skill folder, e.g. -- ../<plugin>/skills/<name>')
  process.exit(1)
}

const client = getCliClient({apiVersion: '2025-02-19'})
const key = () => randomUUID().replace(/-/g, '').slice(0, 12)

/** Every file under `dir`, relative to it. Symlinks are skipped, as the Git Trees API sees them. */
function readSkillFiles(dir: string, root = dir): RepoSkillFile[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return []
    if (stat.isDirectory()) return readSkillFiles(path, root)
    return [{relPath: relative(root, path), content: readFileSync(path, 'utf8')}]
  })
}

async function main() {
  const skillDir = resolve(target!)
  const dirName = basename(skillDir)
  if (basename(dirname(skillDir)) !== 'skills') {
    throw new Error(`Expected <pluginFolder>/skills/<name>, got ${skillDir}`)
  }
  const repoRoot = dirname(dirname(dirname(skillDir)))

  // The same skill can sit in several plugin folders, one per audience.
  const folders = readdirSync(repoRoot).filter((folder) => {
    const path = join(repoRoot, folder)
    return (
      !folder.startsWith('.') &&
      !lstatSync(path).isSymbolicLink() &&
      lstatSync(path).isDirectory() &&
      existsSync(join(path, 'skills', dirName, 'SKILL.md'))
    )
  })
  const files = readSkillFiles(skillDir)
  const parsed = parseRepoSkill(dirName, files)
  if (!folders.length) parsed.problems.push('Pass the real plugin folder path (e.g. ../<plugin>/skills/<name>), not a symlink')

  for (const folder of folders) {
    const copy = readSkillFiles(join(repoRoot, folder, 'skills', dirName))
    const same =
      copy.length === files.length &&
      copy.every((f) => files.find((g) => g.relPath === f.relPath)?.content === f.content)
    if (!same) parsed.problems.push(`${folder}/skills/${dirName} differs from ${relative(repoRoot, skillDir)}`)
  }

  const [audiences, existing, people] = await Promise.all([
    client.fetch<Array<{_id: string; folder: string}>>(
      `*[_type == "audience"]{_id, "folder": coalesce(pluginName, slug.current)}`,
      {},
      {perspective: 'published'},
    ),
    client.fetch<Array<{_id: string}>>(
      `*[_type == "skill" && skillName == $name]{_id}`,
      {name: parsed.skillName},
      {perspective: 'raw'},
    ),
    client.fetch<Array<{name: string; email: string; slackId?: string}>>(
      `*[_type == "orgPerson" && lower(email) in $emails]{name, email, slackId}`,
      {emails: parsed.owners.map((o) => o.email?.toLowerCase()).filter(Boolean)},
      {perspective: 'published'},
    ),
  ])

  if (existing.length) {
    parsed.problems.push(
      `A skill named ${parsed.skillName} is already in the Studio (${existing.map((d) => d._id).join(', ')}). Edit it there instead.`,
    )
  }

  const audienceRefs = folders.map((folder) => {
    const audience = audiences.find((a) => a.folder === folder)
    if (!audience) parsed.problems.push(`No published audience has the plugin folder \`${folder}\``)
    return {_key: key(), _type: 'reference', _ref: audience?._id ?? ''}
  })

  const unmatched: string[] = []
  const owners = parsed.owners.map((owner) => {
    const person = people.find((p) => p.email.toLowerCase() === owner.email?.toLowerCase())
    if (!person) unmatched.push(`${owner.name ?? '?'} <${owner.email ?? 'no email'}>`)
    return {
      _key: key(),
      _type: 'skillOwner',
      name: person?.name ?? owner.name ?? owner.email,
      email: person?.email ?? owner.email,
      ...(person?.slackId ? {slackId: person.slackId} : {}),
    }
  })

  const skillId = `imported-${parsed.skillName}`
  const references = parsed.references.map((ref) => ({
    _id: `${skillId}-ref-${ref.filename.replace(/[^a-z0-9-]/g, '-')}`.slice(0, 128),
    _type: 'skillReference',
    filename: ref.filename,
    content: ref.content,
  }))
  const skill = {
    _id: `drafts.${skillId}`,
    _type: 'skill',
    skillName: parsed.skillName,
    ...(parsed.title ? {title: parsed.title} : {}),
    description: parsed.description,
    content: parsed.content,
    references: references.map((ref) => ({_key: key(), _type: 'reference', _ref: ref._id})),
    audiences: audienceRefs,
    ...(parsed.invocation ? {invocation: parsed.invocation} : {}),
    metadata: {
      ...(parsed.visibility ? {visibility: parsed.visibility} : {}),
      ...(parsed.tags.length ? {tags: parsed.tags} : {}),
      ...(owners.length ? {owners} : {}),
      reviewEveryDays: 90,
    },
  }

  const diffs = parsed.problems.length ? [] : roundTripDiffs(parsed, files)

  console.log(`Skill:       ${parsed.skillName}${parsed.title ? ` (“${parsed.title}”)` : ''}`)
  console.log(`Plugins:     ${folders.join(', ')}`)
  console.log(`References:  ${parsed.references.map((r) => r.filename).join(', ') || 'none'}`)
  console.log(`Owners:      ${owners.map((o) => `${o.name} <${o.email}>${unmatched.some((u) => u.includes(`<${o.email}>`)) ? ' (not in directory)' : ''}`).join(', ') || 'none'}`)
  console.log(`Visibility:  ${parsed.visibility ?? 'not set'}`)
  console.log(`Tags:        ${parsed.tags.join(', ') || 'none'}`)
  if (parsed.invocation) console.log(`Invocation:  ${JSON.stringify(parsed.invocation)}`)
  if (parsed.unmanaged.length) console.log(`Stays in repo only (not managed by the sync): ${parsed.unmanaged.join(', ')}`)
  if (parsed.missing.length) console.log(`\nFill in on the draft before publishing: ${parsed.missing.join(', ')}`)
  if (unmatched.length) console.log(`Owners not in the org directory (kept as typed): ${unmatched.join(', ')}`)

  if (parsed.problems.length) {
    console.log('\nCan’t import:')
    for (const problem of parsed.problems) console.log(`  - ${problem}`)
    process.exit(1)
  }

  if (diffs.length) {
    console.log('\nA Studio publish reformats these files (formatting only, no content is lost):')
    for (const diff of diffs) {
      console.log(`  ${diff.relPath}, first change at line ${diff.line}:`)
      console.log(`    repo:   ${diff.repo ?? '(no line)'}`)
      console.log(`    studio: ${diff.studio ?? '(no line)'}`)
    }
  } else {
    console.log('\nRound trip: a Studio publish writes these files back unchanged, apart from `version:`.')
  }

  if (!apply) {
    console.log('\nDry run — set APPLY=1 to create the references and the skill draft.')
    return
  }

  const tx = client.transaction()
  for (const ref of references) tx.createOrReplace(ref)
  tx.create(skill)
  await tx.commit({visibility: 'sync'})
  console.log(`\nCreated ${references.length} reference(s) and the draft ${skill._id}.`)
  console.log('Next: open it in the Studio, check the metadata, run “Compare with other skills”, then publish.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
