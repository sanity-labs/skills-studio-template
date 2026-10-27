/**
 * Full re-sync: rebuild every published skill's files in the GitHub repo
 * from the Studio, in ONE atomic commit.
 *
 * Use after schema/pipeline changes that affect the generated output for
 * every skill (e.g. the audience→plugin routing, frontmatter changes), or
 * to heal drift between the dataset and the repo. Writes each skill into
 * all of its audience plugin folders, deletes managed files (SKILL.md,
 * flat references/*) from folders a skill doesn't belong to, and
 * regenerates all marketplace manifests + per-plugin plugin.json files.
 * Unmanaged files (evals/, scripts/, repo-native skills, symlinks)
 * are never touched.
 *
 * Dry run (default) prints the plan. APPLY=1 commits to main.
 *
 *   cd studio
 *   GH_TOKEN=$(gh auth token) npx sanity exec scripts/resync-all-skills.ts --with-user-token
 *   GH_TOKEN=$(gh auth token) APPLY=1 npx sanity exec scripts/resync-all-skills.ts --with-user-token
 */
import {getCliClient} from 'sanity/cli'
import {assembleSkillRelativeFiles} from '../utils/assemble'
import {
  generateMarketplaceFiles,
  generateOverviewSkills,
  computeSkillTreeChanges,
  resolveSyncAudiences,
  ALL_AUDIENCES_QUERY,
  AUDIENCES_PROJECTION,
  SKILL_INDEX_QUERY,
  type Audience,
  type SkillIndexEntry,
} from '../utils/audiences'
import {REPO_OWNER, REPO_NAME, REPO_BRANCH} from '../utils/constants'

const ghToken = process.env.GH_TOKEN
if (!ghToken) {
  console.error('Set GH_TOKEN (e.g. GH_TOKEN=$(gh auth token))')
  process.exit(1)
}
const apply = process.env.APPLY === '1'

async function gh(path: string, options: any = {}): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({message: res.statusText}))
    throw new Error(`GitHub API error on ${path}: ${error.message}`)
  }
  return res.json()
}

async function main() {
  // Published perspective: this pushes every skill to GitHub, so it must read
  // the published copies. At apiVersion 2024-01-01 the CLI client defaults to
  // `raw`, which would include drafts and release versions.
  const client = getCliClient({apiVersion: '2024-01-01'}).withConfig({
    perspective: 'published',
  })

  const [skills, allAudiences]: [any[], Audience[]] = await Promise.all([
    client.fetch(`*[_type == "skill" && !(_id in path("drafts.**"))] | order(skillName asc) {
      skillName, description, content,
      "metadata": metadata { tags, visibility, owner, owners },
      invocation,
      references[]->{filename, content},
      "audiences": ${AUDIENCES_PROJECTION}
    }`),
    client.fetch(ALL_AUDIENCES_QUERY),
  ])

  const missing = skills.filter((s) => !s.audiences?.length)
  if (missing.length) {
    throw new Error(`Skills without audiences: ${missing.map((s) => s.skillName).join(', ')}`)
  }

  const ref = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`)
  const headSha = ref.object.sha
  const headCommit = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${headSha}`)
  const baseTreeSha = headCommit.tree.sha
  const fullTree = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${baseTreeSha}?recursive=1`)
  if (fullTree.truncated) throw new Error('Repo tree listing truncated — aborting')
  const existingPaths: string[] = fullTree.tree
    .filter((t: any) => t.type === 'blob')
    .map((t: any) => t.path)

  const writes = new Map<string, string>()
  const deletions = new Set<string>()
  // Accumulates every audience any skill routes into, so the manifests and
  // overviews below describe exactly the folders this re-sync writes. Throws
  // if a skill routes to an audience that can't be resolved into a plugin.
  let syncAudiences: Audience[] = allAudiences
  for (const skill of skills) {
    const skillAudiences: Audience[] = skill.audiences.filter(Boolean)
    syncAudiences = resolveSyncAudiences({
      skillName: skill.skillName,
      skillAudiences,
      allAudiences: syncAudiences,
    })
    const changes = computeSkillTreeChanges({
      skillName: skill.skillName,
      relativeFiles: assembleSkillRelativeFiles(skill),
      skillAudiences,
      allAudiences,
      existingPaths,
    })
    for (const w of changes.writes) writes.set(w.path, w.content)
    for (const d of changes.deletions) deletions.add(d)
  }
  for (const f of generateMarketplaceFiles(syncAudiences)) writes.set(f.path, f.content)
  const skillIndex: SkillIndexEntry[] = await client.fetch(SKILL_INDEX_QUERY)
  for (const f of generateOverviewSkills(syncAudiences, skillIndex)) writes.set(f.path, f.content)
  for (const path of writes.keys()) deletions.delete(path)

  console.log(`\n=== Re-sync plan (${apply ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log(`HEAD: ${headSha}`)
  console.log(`Skills: ${skills.length}, writes: ${writes.size}, deletions: ${deletions.size}`)
  if (deletions.size) {
    for (const d of [...deletions].sort()) console.log(`  - ${d}`)
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with APPLY=1 to commit.')
    return
  }

  const treeItems = [
    ...[...writes.entries()].map(([path, content]) => ({
      path,
      mode: '100644',
      type: 'blob',
      content,
    })),
    ...[...deletions].map((path) => ({path, mode: '100644', type: 'blob', sha: null})),
  ]
  const newTree = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
    method: 'POST',
    body: {base_tree: baseTreeSha, tree: treeItems},
  })
  const newCommit = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
    method: 'POST',
    body: {
      message: `Re-sync all skills from Skills Studio (${skills.length} skills, audience routing)`,
      tree: newTree.sha,
      parents: [headSha],
    },
  })
  await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`, {
    method: 'PATCH',
    body: {sha: newCommit.sha},
  })
  console.log(`\nCommitted: https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${newCommit.sha}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
