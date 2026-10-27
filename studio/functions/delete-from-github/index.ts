import {documentEventHandler} from '@sanity/functions'
import {createClient} from '@sanity/client'
import {
  generateMarketplaceFiles,
  generateOverviewSkills,
  pluginFolder,
  ALL_AUDIENCES_QUERY,
  SKILL_INDEX_QUERY,
  type Audience,
  type SkillIndexEntry,
} from '../publish-to-github/marketplace'
import {REPO_OWNER, REPO_NAME, REPO_BRANCH} from '../../utils/constants'

type EventData = {
  _id: string
  skillName: string
}

async function githubApi(path: string, token: string, options: any = {}): Promise<any> {
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
    throw new Error(`GitHub API error: ${error.message}`)
  }
  return res.json()
}

export const handler = documentEventHandler<EventData>(async ({context, event}) => {
  const skillName = event.data?.skillName
  if (!skillName) {
    console.error('No skillName in deleted document')
    return
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error('GITHUB_TOKEN not set')
    return
  }

  console.info(`Deleting skill ${skillName} from all plugin folders`)

  if (context.local) {
    console.log(`DRY RUN — would delete ${skillName} from all plugin folders`)
    return
  }

  // Published perspective: the manifests and overviews rebuilt below describe
  // what is live on GitHub, never a draft or a release version.
  const client = createClient({
    ...context.clientOptions,
    apiVersion: '2024-01-01',
    useCdn: false,
    perspective: 'published',
  })

  try {
    // The document is gone, so its audiences are unknowable — sweep the
    // skill's folder out of every audience plugin folder instead.
    const [allAudiences, skillIndex]: [Audience[], SkillIndexEntry[]] = await Promise.all([
      client.fetch(ALL_AUDIENCES_QUERY),
      client.fetch(SKILL_INDEX_QUERY),
    ])
    const prefixes = [...new Set(allAudiences.map(pluginFolder))].map(
      (folder) => `${folder}/skills/${skillName}/`,
    )

    // Get current HEAD and the full tree. NOTE: real skill files live under
    // the plugin folders — never write through the top-level skills/ symlink
    // (the Git Trees API does not follow symlinks).
    const ref = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`, token)
    const headSha = ref.object.sha
    const headCommit = await githubApi(
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${headSha}`,
      token,
    )
    const baseTreeSha = headCommit.tree.sha
    const fullTree = await githubApi(
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${baseTreeSha}?recursive=1`,
      token,
    )
    if (fullTree.truncated) {
      throw new Error('Repo tree listing truncated — aborting delete')
    }

    const toDelete: string[] = fullTree.tree
      .filter(
        (item: {path: string; type: string}) =>
          item.type === 'blob' && prefixes.some((prefix) => item.path.startsWith(prefix)),
      )
      .map((item: {path: string}) => item.path)

    if (toDelete.length === 0) {
      console.info(`No files found for ${skillName} in any plugin folder — nothing to delete`)
      return
    }

    console.info(`Removing ${toDelete.length} file(s) for ${skillName}`)

    // Marketplace manifests regenerate from audience docs — the deleted
    // skill no longer counts, so an audience losing its last skill drops
    // out of the manifests here.
    const marketplaceFiles = [
      ...generateMarketplaceFiles(allAudiences),
      ...generateOverviewSkills(allAudiences, skillIndex),
    ]

    const newTree = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, token, {
      method: 'POST',
      body: {
        base_tree: baseTreeSha,
        tree: [
          ...marketplaceFiles.map((f) => ({
            path: f.path,
            mode: '100644' as const,
            type: 'blob' as const,
            content: f.content,
          })),
          ...toDelete.map((path) => ({
            path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: null,
          })),
        ],
      },
    })

    const newCommit = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, token, {
      method: 'POST',
      body: {
        message: `Delete ${skillName} (unpublished from Sanity Studio)`,
        tree: newTree.sha,
        parents: [headSha],
      },
    })

    await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`, token, {
      method: 'PATCH',
      body: {sha: newCommit.sha},
    })

    console.info(`Deleted skill folder(s). Commit: ${newCommit.sha}`)
  } catch (error) {
    console.error(`Failed to delete ${skillName} from GitHub:`, error)
  }
})
