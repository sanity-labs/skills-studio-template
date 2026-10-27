import {useState, useCallback} from 'react'
import {useClient, type DocumentActionProps} from 'sanity'
import {CheckmarkCircleIcon} from '@sanity/icons'
import {getPublishedId} from '../utils/documentIds'

/**
 * One-click freshness attestation: sets metadata.lastReviewedAt on the
 * published document. Metadata is excluded from the sync delta filter, so
 * this causes no GitHub churn — it only feeds the overdue badge and the
 * weekly freshness digest.
 */
export function MarkReviewedAction(props: DocumentActionProps) {
  const {id, published, onComplete} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const [busy, setBusy] = useState(false)

  const handle = useCallback(async () => {
    setBusy(true)
    try {
      await client
        // `getPublishedId`, not a `drafts.` strip: from inside a release the
        // ID is `versions.<releaseId>.<id>`, and the attestation belongs on
        // the published skill either way.
        .patch(getPublishedId(id))
        .set({'metadata.lastReviewedAt': new Date().toISOString()})
        .commit()
    } finally {
      setBusy(false)
      onComplete()
    }
  }, [client, id, onComplete])

  if (!published) return null

  return {
    label: busy ? 'Marking…' : 'Mark reviewed',
    icon: CheckmarkCircleIcon,
    tone: 'positive' as const,
    disabled: busy,
    onHandle: handle,
  }
}
