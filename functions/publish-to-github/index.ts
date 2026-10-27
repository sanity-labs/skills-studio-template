import {documentEventHandler} from '@sanity/functions'
import {createClient} from '@sanity/client'
import {DocumentId, getPublishedId} from '@sanity/id-utils'
import {defineQuery} from 'groq'
import {assembleSkillRelativeFiles} from './assemble'
import {
  generateMarketplaceFiles,
  generateOverviewSkills,
  computeSkillTreeChanges,
  resolveSyncAudiences,
  staleGeneratedPluginFiles,
  ALL_AUDIENCES_QUERY,
  SKILL_INDEX_QUERY,
  type Audience,
  type SkillIndexEntry,
} from './marketplace'
import {REPO_OWNER, REPO_NAME, REPO_BRANCH} from '../../studio/utils/constants'

const SKILL_BY_REF_QUERY = defineQuery(`*[_type == "skill" && references($refId)][0]{
  _id,
  skillName,
  description,
  content,
  "metadata": metadata { tags, visibility, owner, owners },
  invocation,
  references[]->{filename, content},
  "audiences": audiences[]->{
    "slug": slug.current, title, pluginTitle, pluginDescription, autoInstall, pluginName
  }
}`)

async function githubApi(path: string, token: string, options: any = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({message: res.statusText}))
    throw new Error(`GitHub API error (${res.status}): ${error.message}`)
  }
  return res.json()
}

/**
 * Fetch the full recursive blob list of a tree. Used to compute stale-copy
 * deletions (skill files in plugin folders the skill no longer belongs to,
 * or removed references in folders it keeps).
 */
async function getExistingBlobPaths(baseTreeSha: string, token: string): Promise<string[]> {
  const tree = await githubApi(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${baseTreeSha}?recursive=1`,
    token,
  )
  if (tree.truncated) {
    throw new Error('Repo tree listing truncated — stale copies cannot be cleaned up safely')
  }
  return tree.tree
    .filter((entry: {type: string}) => entry.type === 'blob')
    .map((entry: {path: string}) => entry.path)
}

/**
 * Patch the skill document with sync metadata.
 *
 * Uses SANITY_WRITE_TOKEN (an explicit write-scoped token) instead of
 * context.clientOptions, because the runtime's default client is
 * read-scoped — writes back silently fail with 401.
 *
 * Retries once on transient failure (network blip, rate limit). On
 * permanent failure, records the error on the document via
 * `lastSyncError` so the Studio banner can surface it to the user.
 *
 * IMPORTANT: lastPublishedCommit is recorded even if the timestamp write
 * fails later — the commit IS the load-bearing fact (GitHub has the file).
 */
async function patchSkillSyncMetadata(
  context: any,
  docId: string,
  skillName: string,
  commitSha: string,
): Promise<{success: boolean; error?: string}> {
  const writeToken = process.env.SANITY_WRITE_TOKEN
  const clientOpts = writeToken
    ? {...context.clientOptions, token: writeToken, apiVersion: '2024-01-01', useCdn: false}
    : {...context.clientOptions, apiVersion: '2024-01-01', useCdn: false}

  if (!writeToken) {
    console.warn(
      `SANITY_WRITE_TOKEN not set — falling back to context.clientOptions. ` +
        `If patches fail with 401, set SANITY_WRITE_TOKEN as a Function secret.`,
    )
  }

  const writeClient = createClient(clientOpts)

  const patchPayload = {
    lastPublishedAt: new Date().toISOString(),
    lastPublishedCommit: commitSha,
    lastSyncError: null, // Clear any prior error
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await writeClient
        .patch(docId)
        .set(patchPayload)
        .commit({dryRun: context.local})
      console.log(`Patched skill ${skillName} (${docId}) with commit ${commitSha.slice(0, 7)}`)
      return {success: true}
    } catch (err: any) {
      const msg = err?.message || String(err)
      const isLastAttempt = attempt === 2
      console.error(
        `Patch attempt ${attempt}/2 for ${skillName} (${docId}) failed: ${msg}` +
          (isLastAttempt ? ' — giving up' : ' — retrying in 1s'),
      )
      if (isLastAttempt) {
        // Try to record the error on the doc so Studio can show it.
        // Use a separate retry-less patch — if THIS fails, log and exit
        // (GitHub commit already succeeded; the user can re-publish).
        try {
          await writeClient
            .patch(docId)
            .set({
              lastPublishedCommit: commitSha, // Still record commit — it's truth
              lastSyncError: `Failed to record sync timestamp: ${msg.slice(0, 200)}`,
            })
            .commit({dryRun: context.local})
          console.warn(`Recorded lastSyncError on ${skillName} (${docId})`)
        } catch (recordErr: any) {
          console.error(
            `Could not record lastSyncError on ${skillName} (${docId}): ` +
              `${recordErr?.message || recordErr}`,
          )
        }
        return {success: false, error: msg}
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return {success: false, error: 'unreachable'}
}

/** Record a sync error on the document so the Studio banner can surface it. */
async function patchSkillSyncError(context: any, docId: string, message: string): Promise<void> {
  const writeToken = process.env.SANITY_WRITE_TOKEN
  const clientOpts = writeToken
    ? {...context.clientOptions, token: writeToken, apiVersion: '2024-01-01', useCdn: false}
    : {...context.clientOptions, apiVersion: '2024-01-01', useCdn: false}
  try {
    await createClient(clientOpts)
      .patch(docId)
      .set({lastSyncError: message.slice(0, 300)})
      .commit({dryRun: context.local})
  } catch (err: any) {
    console.error(`Could not record lastSyncError on ${docId}: ${err?.message || err}`)
  }
}

export const handler = documentEventHandler(async ({context, event}) => {
  const ghToken = process.env.GITHUB_TOKEN
  if (!ghToken) {
    throw new Error('GITHUB_TOKEN environment variable is not set')
  }

  // Read-only client for queries. Pinned to the published perspective: the
  // audience manifests and the skill index it feeds are the state of the repo
  // on GitHub, and at apiVersion 2024-01-01 the client would otherwise default
  // to `raw` and fold drafts and release versions into them.
  const client = createClient({
    ...context.clientOptions,
    apiVersion: '2024-01-01',
    useCdn: false,
    perspective: 'published',
  })

  let skill: any

  if (event.data?._type === 'skillReference') {
    // A reference file changed — look up the parent skill
    // `@sanity/id-utils` rather than a `drafts.` strip — this runs outside the
    // Studio, where `sanity`'s own ID helpers aren't available. The event
    // filter already excludes `versions.**`, but the strip would have handed a
    // version ID on untouched if it ever stops.
    const refId = getPublishedId(DocumentId(event.data._id))
    console.log(`Reference changed: ${refId} (${event.data.filename})`)

    skill = await client.fetch(
      SKILL_BY_REF_QUERY,
      {refId},
    )

    if (!skill) {
      console.log(`No parent skill found for reference ${refId} — skipping`)
      return
    }
    console.log(`Found parent skill: ${skill.skillName}`)
  } else {
    // Direct skill change
    skill = event.data
  }

  if (!skill?.skillName) {
    console.error('No skillName found in event data')
    return
  }

  const skillAudiences: Audience[] = (skill.audiences || []).filter(Boolean)
  if (skillAudiences.length === 0) {
    // Surface in the Studio banner and bail — without audiences we don't
    // know which plugin folders to write to.
    const msg = `Skill ${skill.skillName} has no audiences — assign at least one audience and re-publish`
    console.error(msg)
    if (!context.local && skill._id) {
      await patchSkillSyncError(context, getPublishedId(DocumentId(skill._id)), msg)
    }
    return
  }

  console.log(
    `Publishing skill: ${skill.skillName} (audiences: ${skillAudiences.map((a) => a.title).join(', ')})`,
  )

  // Read-side data for routing: every audience with its skill count (for
  // manifests + cleanup) and the full skill index (for overview skills).
  const [allAudiences, skillIndex]: [Audience[], SkillIndexEntry[]] = await Promise.all([
    client.fetch(ALL_AUDIENCES_QUERY),
    client.fetch(SKILL_INDEX_QUERY),
  ])

  // One audience set for both the folders we write into and the manifests /
  // overviews we generate, so they cannot disagree. Throws before any GitHub
  // call if an audience being routed to can't be resolved into a plugin —
  // committing then would leave an orphan folder with no plugin.json.
  let syncAudiences: Audience[]
  try {
    syncAudiences = resolveSyncAudiences({
      skillName: skill.skillName,
      skillAudiences,
      allAudiences,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error(msg)
    if (!context.local && skill._id) {
      await patchSkillSyncError(context, getPublishedId(DocumentId(skill._id)), msg)
    }
    throw err
  }

  // Git Trees API — atomic multi-file commit
  const ref = await githubApi(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`,
    ghToken,
  )
  const headSha = ref.object.sha

  const headCommit = await githubApi(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${headSha}`,
    ghToken,
  )
  const baseTreeSha = headCommit.tree.sha

  const existingPaths = context.local ? [] : await getExistingBlobPaths(baseTreeSha, ghToken)

  const {writes, deletions: skillDeletions} = computeSkillTreeChanges({
    skillName: skill.skillName,
    relativeFiles: assembleSkillRelativeFiles(skill),
    skillAudiences,
    allAudiences,
    existingPaths,
  })
  // A skill moving audiences can empty its old plugin; drop that plugin's
  // generated files with the same commit.
  const deletions = [
    ...skillDeletions,
    ...staleGeneratedPluginFiles({syncAudiences, existingPaths, pendingDeletions: skillDeletions}),
  ]

  // Marketplace manifests + per-plugin plugin.json + generated overview
  // skills, regenerated from the audience documents and skill index.
  const files = [
    ...writes,
    ...generateMarketplaceFiles(syncAudiences),
    ...generateOverviewSkills(syncAudiences, skillIndex),
  ]

  // In local testing mode, log what would happen and exit
  if (context.local) {
    console.log('DRY RUN — would commit these files:')
    for (const file of files) {
      console.log(`  ${file.path} (${file.content.length} bytes)`)
    }
    console.log('\nSKILL.md preview:')
    console.log(files[0].content.slice(0, 500))
    return
  }

  if (deletions.length > 0) {
    console.log(`Deleting ${deletions.length} stale file(s):`)
    for (const path of deletions) {
      console.log(`  - ${path}`)
    }
  }

  // Tree entries: inline content for writes, sha: null for deletions
  const treeItems: any[] = [
    ...files.map((file) => ({
      path: file.path,
      mode: '100644',
      type: 'blob',
      content: file.content,
    })),
    ...deletions.map((path) => ({
      path,
      mode: '100644',
      type: 'blob',
      sha: null,
    })),
  ]

  // Create tree
  const newTree = await githubApi(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
    ghToken,
    {
      method: 'POST',
      body: {base_tree: baseTreeSha, tree: treeItems},
    },
  )

  // Create commit
  const newCommit = await githubApi(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
    ghToken,
    {
      method: 'POST',
      body: {
        message: event.data?._type === 'skillReference'
          ? `Update ${skill.skillName} (reference: ${event.data.filename}) from Sanity Studio`
          : `Update ${skill.skillName} from Sanity Studio (audiences: ${skillAudiences.map((a) => a.title).join(', ')})`,
        tree: newTree.sha,
        parents: [headSha],
      },
    },
  )

  // Update HEAD
  await githubApi(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`,
    ghToken,
    {
      method: 'PATCH',
      body: {sha: newCommit.sha},
    },
  )

  console.log(`Committed: ${newCommit.sha}`)

  // Patch the skill document with commit info (with retry + error surfacing).
  // GitHub commit already succeeded — this only updates Studio metadata.
  const docId = getPublishedId(DocumentId(skill._id))
  await patchSkillSyncMetadata(context, docId, skill.skillName, newCommit.sha)
})
