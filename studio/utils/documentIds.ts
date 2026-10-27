/**
 * Document ID handling for a dataset that has Content Releases in it.
 *
 * A document group stores up to three kinds of copy, and every one of them can
 * reach a custom tool, a field component or a document action:
 *
 *   published  `mySkill`
 *   draft      `drafts.mySkill`
 *   version    `versions.<releaseId>.mySkill`   (one per release)
 *
 * The idiom this file replaces — `id.replace(/^drafts\./, '')` — is wrong for
 * the third: it leaves the prefix in place, so a version ID passes straight
 * through and is then treated as if it were a published ID. That is how
 * `drafts.versions.rAbc123.mySkill` gets written, how `metadata.lastReviewedAt`
 * lands on a release version instead of the published document, and how the
 * Skills Explorer ended up linking to a document no structure pane could open.
 *
 * Use `getPublishedId` (re-exported from `sanity`) whenever an ID identifies a
 * document *group* — reference lookups, `skillStats` bookkeeping, sync state —
 * and `resolveWriteTarget` when writing back to the copy the editor has open.
 */
import {getPublishedId, getVersionFromId, isVersionId} from 'sanity'

export {getPublishedId, getVersionFromId, isVersionId}

/**
 * Where a programmatic edit from a document action should land.
 *
 * `version` means the editor is working inside a release and the form they are
 * looking at is the version document: patch it directly, exactly as typing in
 * the form would. `draft` is the normal case, where the write goes through the
 * draft of the published document.
 */
export type WriteTarget =
  | {kind: 'version'; id: string; publishedId: string; releaseId: string}
  | {kind: 'draft'; id: string; publishedId: string}

/**
 * Resolve the document a write should target from the ID a document action
 * receives in `props.id`.
 */
export function resolveWriteTarget(documentId: string): WriteTarget {
  const publishedId = getPublishedId(documentId)

  if (isVersionId(documentId)) {
    return {
      kind: 'version',
      id: documentId,
      publishedId,
      // `isVersionId` already guarantees the release segment is there
      releaseId: getVersionFromId(documentId) as string,
    }
  }

  return {kind: 'draft', id: `drafts.${publishedId}`, publishedId}
}
