import {useEffect, useMemo, useRef, useState} from 'react'
import {useFormValue, useDocumentStore} from 'sanity'
import {getPublishedId} from '../utils/documentIds'
import {useObservable} from 'react-rx'
import {Card, Flex, Text, Spinner} from '@sanity/ui'
import {CheckmarkCircleIcon, WarningOutlineIcon, ErrorOutlineIcon} from '@sanity/icons'
import {formatRelativeTime} from '../utils/formatRelativeTime'
import confetti from 'canvas-confetti'
import {REPO_URL} from '../utils/constants'

const SYNC_TIMEOUT_MS = 30_000

type SyncState = 'idle' | 'syncing' | 'synced' | 'timeout'

export function GitHubSyncBanner() {
  const lastPublishedAt = useFormValue(['lastPublishedAt']) as string | undefined
  const lastPublishedCommit = useFormValue(['lastPublishedCommit']) as string | undefined
  const lastSyncError = useFormValue(['lastSyncError']) as string | undefined
  const documentId = useFormValue(['_id']) as string | undefined

  // The sync state belongs to the skill, not to the copy on screen: a
  // `versions.<releaseId>.` ID would report the release version's own
  // (usually empty) sync fields instead of the published skill's.
  const publishedId = documentId ? getPublishedId(documentId) : undefined

  // Listen to the published document directly for real-time commit updates
  const documentStore = useDocumentStore()
  const publishedDoc$ = useMemo(
    () =>
      publishedId
        ? documentStore.listenQuery(
            `*[_id == $id][0]{lastPublishedCommit, lastPublishedAt, lastSyncError}`,
            {id: publishedId},
            {},
          )
        : null,
    [documentStore, publishedId],
  )
  const publishedDoc = useObservable(publishedDoc$, null) as {
    lastPublishedCommit?: string
    lastPublishedAt?: string
    lastSyncError?: string
  } | null

  // Use the published doc's values if available, fall back to form values
  const liveCommit = publishedDoc?.lastPublishedCommit ?? lastPublishedCommit
  const livePublishedAt = publishedDoc?.lastPublishedAt ?? lastPublishedAt
  const liveSyncError = publishedDoc?.lastSyncError ?? lastSyncError

  const [syncState, setSyncState] = useState<SyncState>('idle')
  const commitAtSyncStart = useRef<string | undefined>(undefined)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track the previous commit to detect changes
  const prevCommitRef = useRef<string | undefined>(liveCommit)

  // Detect when a publish just happened:
  // lastPublishedAt is very recent (within 10s) and the commit hasn't changed yet
  useEffect(() => {
    if (!livePublishedAt) return
    if (syncState === 'syncing' || syncState === 'timeout') return

    const publishedAgo = Date.now() - new Date(livePublishedAt).getTime()

    // If published within the last 10 seconds and we're not already tracking
    if (publishedAgo < 10_000 && publishedAgo >= 0) {
      // Check if the commit is the same as what we had before (meaning Function hasn't patched yet)
      // Or if there's no commit at all (first publish)
      const commitUnchanged =
        !liveCommit || liveCommit === prevCommitRef.current

      if (commitUnchanged && syncState === 'idle') {
        setSyncState('syncing')
        commitAtSyncStart.current = liveCommit
      }
    }
  }, [livePublishedAt, liveCommit, syncState])

  // Detect when the commit SHA changes (Function completed)
  useEffect(() => {
    if (
      syncState === 'syncing' &&
      liveCommit &&
      liveCommit !== commitAtSyncStart.current
    ) {
      // Commit changed — sync succeeded!
      setSyncState('synced')
      prevCommitRef.current = liveCommit

      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      // Reset to idle after 15 seconds so the banner goes back to normal
      const resetTimer = setTimeout(() => setSyncState('idle'), 15_000)
      return () => clearTimeout(resetTimer)
    }

    // Also handle case where commit changed while idle (e.g., page was refreshed)
    if (syncState === 'idle' && liveCommit !== prevCommitRef.current) {
      prevCommitRef.current = liveCommit
    }
  }, [liveCommit, syncState])

  // 30-second timeout for syncing state
  useEffect(() => {
    if (syncState === 'syncing') {
      timeoutRef.current = setTimeout(() => {
        setSyncState('timeout')
      }, SYNC_TIMEOUT_MS)

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
      }
    }
  }, [syncState])

  // Allow dismissing the timeout warning
  const handleDismissTimeout = () => {
    setSyncState('idle')
    prevCommitRef.current = liveCommit
  }

  // Fire confetti when sync completes
  useEffect(() => {
    if (syncState === 'synced') {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#43d675', '#2276fc', '#f9a825', '#e91e63'],
        disableForReducedMotion: true,
      })
    }
  }, [syncState])

  // If commit arrives after timeout, still show success
  useEffect(() => {
    if (
      syncState === 'timeout' &&
      liveCommit &&
      liveCommit !== commitAtSyncStart.current
    ) {
      setSyncState('synced')
      prevCommitRef.current = liveCommit

      const resetTimer = setTimeout(() => setSyncState('idle'), 15_000)
      return () => clearTimeout(resetTimer)
    }
  }, [liveCommit, syncState])

  // --- Sync error state, never-synced skill ---
  // The Function ran and refused to sync (e.g. the skill has no audiences, so
  // there is no plugin folder to write into) — it recorded the reason on the
  // document but there is no commit. Without this branch the error is written
  // and then hidden: we fall through to "Not yet synced to GitHub. Publish this
  // skill to sync it.", which tells the author to do the thing they just did.
  if (liveSyncError && !liveCommit) {
    return (
      <Card padding={3} radius={2} tone="critical" border marginBottom={4}>
        <Flex align="flex-start" gap={3}>
          <Text size={1}>
            <ErrorOutlineIcon />
          </Text>
          <Flex direction="column" gap={2}>
            <Text size={1} weight="semibold">
              Not synced to GitHub — the last sync was refused
            </Text>
            <Text size={1} muted>
              {liveSyncError}
            </Text>
            <Text size={0} muted>
              Fix the problem above and publish again. If it keeps happening, ask a
              developer to check the Function logs.
            </Text>
          </Flex>
        </Flex>
      </Card>
    )
  }

  // --- Sync error state, already-synced skill ---
  // Commit landed on GitHub, but writing back metadata to Studio failed.
  // Show this BEFORE the "not yet synced" fallback so users see the right diagnosis.
  if (liveSyncError && liveCommit) {
    return (
      <Card padding={3} radius={2} tone="caution" border marginBottom={4}>
        <Flex align="flex-start" gap={3}>
          <Text size={1}>
            <WarningOutlineIcon />
          </Text>
          <Flex direction="column" gap={2}>
            <Text size={1} weight="semibold">
              Synced to GitHub, but Studio couldn't record the sync time
            </Text>
            <Text size={1} muted>
              The file is on GitHub at{' '}
              <a
                href={`${REPO_URL}/commit/${liveCommit}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{color: 'inherit'}}
              >
                {liveCommit.slice(0, 7)}
              </a>
              . Re-publish to clear this message. If it keeps happening, ask a developer
              to check the Function logs.
            </Text>
            <Text size={0} muted style={{fontFamily: 'monospace', opacity: 0.7}}>
              {liveSyncError}
            </Text>
          </Flex>
        </Flex>
      </Card>
    )
  }

  // --- Syncing state ---
  if (syncState === 'syncing') {
    return (
      <Card padding={3} radius={2} tone="caution" border marginBottom={4}>
        <Flex align="center" gap={3}>
          <Spinner muted size={1} />
          <Text size={1} muted>
            Syncing to GitHub…
          </Text>
        </Flex>
      </Card>
    )
  }

  // --- Timeout state ---
  if (syncState === 'timeout') {
    return (
      <Card padding={3} radius={2} tone="critical" border marginBottom={4}>
        <Flex align="center" gap={3}>
          <Text size={1}>
            <ErrorOutlineIcon />
          </Text>
          <Text size={1} muted>
            Sync didn't complete in 30 seconds. Try re-publishing, or ask a developer to check Function logs if the problem persists.{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                handleDismissTimeout()
              }}
              style={{color: 'inherit', textDecoration: 'underline'}}
            >
              Dismiss
            </a>
          </Text>
        </Flex>
      </Card>
    )
  }

  // --- Just synced state ---
  if (syncState === 'synced' && liveCommit) {
    return (
      <Card padding={3} radius={2} tone="positive" border marginBottom={4}>
        <Flex align="center" gap={3}>
          <Text size={1}>
            <CheckmarkCircleIcon />
          </Text>
          <Text size={1} muted>
            Synced to GitHub{' · '}
            <a
              href={`${REPO_URL}/commit/${liveCommit}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{color: 'inherit'}}
            >
              {liveCommit.slice(0, 7)}
            </a>
          </Text>
        </Flex>
      </Card>
    )
  }

  // --- Not yet synced ---
  if (!liveCommit) {
    return (
      <Card padding={3} radius={2} tone="caution" border marginBottom={4}>
        <Flex align="center" gap={3}>
          <Text size={1}>
            <WarningOutlineIcon />
          </Text>
          <Text size={1} muted>
            Not yet synced to GitHub. Publish this skill to sync it.
          </Text>
        </Flex>
      </Card>
    )
  }

  // --- Synced (default) ---
  return (
    <Card padding={3} radius={2} tone="positive" border marginBottom={4}>
      <Flex align="center" gap={3}>
        <Text size={1}>
          <CheckmarkCircleIcon />
        </Text>
        <Text size={1} muted>
          Synced to GitHub
          {livePublishedAt ? ` ${formatRelativeTime(livePublishedAt)}` : ''}
          {' · '}
          <a
            href={`${REPO_URL}/commit/${liveCommit}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{color: 'inherit'}}
          >
            {liveCommit.slice(0, 7)}
          </a>
          {' · publishing will re-sync'}
        </Text>
      </Flex>
    </Card>
  )
}
