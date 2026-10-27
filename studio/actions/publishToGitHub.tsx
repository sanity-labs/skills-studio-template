import {useState, useCallback} from 'react'
import {useClient, type DocumentActionProps} from 'sanity'
import {useSecrets, SettingsView} from '@sanity/studio-secrets'
import {UploadIcon} from '@sanity/icons'
import {defineQuery} from 'groq'
import {assembleSkillRelativeFiles} from '../utils/assemble'
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
} from '../utils/audiences'
import {REPO_OWNER, REPO_NAME, REPO_BRANCH} from '../utils/constants'
import {getPublishedId, isVersionId} from '../utils/documentIds'

const GITHUB_SECRETS_NAMESPACE = 'github'
const GITHUB_SECRETS_KEYS = [
  {key: 'token', title: 'GitHub Personal Access Token (repo scope)'},
]

const SKILL_FOR_PUBLISH_QUERY = defineQuery(`*[_type == "skill" && _id == $id][0]{
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

// Helper to make GitHub API calls
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

export function PublishToGitHubAction(props: DocumentActionProps) {
  const {id, type, onComplete, published, draft} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const {secrets} = useSecrets(GITHUB_SECRETS_NAMESPACE)
  
  const [isPublishing, setIsPublishing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const ghToken = (secrets as {token?: string} | null)?.token

  const handlePublish = useCallback(async () => {
    if (!ghToken) {
      setShowSettings(true)
      return
    }

    setIsPublishing(true)
    setError(null)

    try {
      // 1. Fetch skill with dereferenced references
      // Always the published skill: GitHub holds what is live, and the
      // Studio client reads raw, so the ID has to name the copy we mean.
      const skill = await client.fetch(
        SKILL_FOR_PUBLISH_QUERY,
        {id: getPublishedId(id)}
      )

      if (!skill) throw new Error('Skill document not found')
      if (!skill.skillName) throw new Error('Skill name is required')

      const skillAudiences: Audience[] = (skill.audiences || []).filter(Boolean)
      if (skillAudiences.length === 0) {
        throw new Error('Assign at least one audience before syncing — audiences decide which plugin folders this skill is published into')
      }

      // 2. Fetch all audiences (manifests + cleanup) and the skill index
      //    (overviews). Through a published-perspective client: the Studio's
      //    own client reads raw, which folds drafts and release versions into
      //    the manifests and overview skills this writes to GitHub.
      const publishedClient = client.withConfig({perspective: 'published'})
      const [allAudiences, skillIndex]: [Audience[], SkillIndexEntry[]] = await Promise.all([
        publishedClient.fetch(ALL_AUDIENCES_QUERY),
        publishedClient.fetch(SKILL_INDEX_QUERY),
      ])

      // One audience set for both the folders we write into and the manifests /
      // overviews we generate. Throws before any GitHub call if an audience
      // being routed to can't be resolved into a plugin.
      const syncAudiences = resolveSyncAudiences({
        skillName: skill.skillName,
        skillAudiences,
        allAudiences,
      })

      // 3. Git Trees API - atomic multi-file commit
      // Get current HEAD
      const ref = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`, ghToken)
      const headSha = ref.object.sha

      // Get current commit's tree, with the full blob list for cleanup
      const headCommit = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${headSha}`, ghToken)
      const baseTreeSha = headCommit.tree.sha
      const fullTree = await githubApi(
        `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${baseTreeSha}?recursive=1`,
        ghToken,
      )
      if (fullTree.truncated) {
        throw new Error('Repo tree too large to list — stale copies cannot be cleaned up safely')
      }
      const existingPaths = fullTree.tree
        .filter((entry: {type: string}) => entry.type === 'blob')
        .map((entry: {path: string}) => entry.path)

      // 4. Assemble: skill files across its audience plugin folders, stale-copy
      //    deletions, and regenerated marketplace manifests
      const {writes, deletions: skillDeletions} = computeSkillTreeChanges({
        skillName: skill.skillName,
        relativeFiles: assembleSkillRelativeFiles(skill),
        skillAudiences,
        allAudiences,
        existingPaths,
      })
      const deletions = [
        ...skillDeletions,
        ...staleGeneratedPluginFiles({syncAudiences, existingPaths, pendingDeletions: skillDeletions}),
      ]
      const files = [
        ...writes,
        ...generateMarketplaceFiles(syncAudiences),
        ...generateOverviewSkills(syncAudiences, skillIndex),
      ]

      const treeItems = [
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

      // Create new tree
      const newTree = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, ghToken, {
        method: 'POST',
        body: {base_tree: baseTreeSha, tree: treeItems},
      })

      // Create commit
      const newCommit = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, ghToken, {
        method: 'POST',
        body: {
          message: `Update ${skill.skillName} from Sanity Studio (audiences: ${skillAudiences.map((a) => a.title).join(', ')})`,
          tree: newTree.sha,
          parents: [headSha],
        },
      })

      // Update HEAD ref
      await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`, ghToken, {
        method: 'PATCH',
        body: {sha: newCommit.sha},
      })

      // 4. Patch skill document with commit info
      await client
        .patch(getPublishedId(id))
        .set({
          lastPublishedAt: new Date().toISOString(),
          lastPublishedCommit: newCommit.sha,
        })
        .commit()

      setSuccess(newCommit.sha)
      setIsPublishing(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setIsPublishing(false)
    }
  }, [ghToken, id, client])

  // Build the dialog content
  let dialog = null

  if (showSettings) {
    dialog = {
      type: 'dialog' as const,
      header: 'GitHub Settings',
      onClose: () => setShowSettings(false),
      content: (
        <SettingsView
          title="GitHub Configuration"
          namespace={GITHUB_SECRETS_NAMESPACE}
          keys={GITHUB_SECRETS_KEYS}
          onClose={() => setShowSettings(false)}
        />
      ),
    }
  } else if (error) {
    dialog = {
      type: 'dialog' as const,
      header: 'Sync failed',
      onClose: () => {
        setError(null)
        if (onComplete) onComplete()
      },
      content: (
        <div style={{padding: '1em'}}>
          <p>{error}</p>
          <p style={{marginTop: '0.5em', fontSize: '0.9em', color: '#666'}}>
            If this keeps happening, check that your GitHub token is valid in the settings menu (⚙️).
          </p>
        </div>
      ),
    }
  } else if (success) {
    dialog = {
      type: 'dialog' as const,
      header: 'Synced to GitHub',
      onClose: () => {
        setSuccess(null)
        if (onComplete) onComplete()
      },
      content: (
        <div style={{padding: '1em'}}>
          <p>Synced to GitHub.</p>
          <p>
            Commit:{' '}
            <a
              href={`https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${success}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {success.slice(0, 7)}
            </a>
          </p>
        </div>
      ),
    }
  }

  // Show "Sync to GitHub" (positive) if never synced,
  // "Re-sync to GitHub" (default) if already synced.
  const hasBeenSynced = !!published?.lastPublishedCommit

  // Hide when there's a draft (user should Publish first, Function handles sync)
  // or when document has never been published (nothing to sync)
  if (draft || !published) {
    return null
  }

  // Inside a release the form shows that release's version. Syncing from here
  // would push content the release has not published yet — and the release is
  // precisely the decision to publish it later — so the action explains itself
  // instead of quietly syncing the published copy behind the editor's back.
  if (isVersionId(id)) {
    return {
      label: 'Sync to GitHub',
      icon: UploadIcon,
      disabled: true,
      title: 'Not available inside a release — GitHub gets this skill when the release publishes',
    }
  }

  return {
    label: isPublishing ? 'Syncing…' : hasBeenSynced ? 'Re-sync to GitHub' : 'Sync to GitHub',
    icon: UploadIcon,
    disabled: isPublishing,
    tone: hasBeenSynced ? ('default' as const) : ('positive' as const),
    onHandle: handlePublish,
    dialog,
  }
}
