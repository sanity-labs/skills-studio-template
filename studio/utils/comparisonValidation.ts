/**
 * Validation for the comparison with other skills, read from the snapshot the
 * comparison stores on the skill (`metadata.comparison`). No query and no
 * model call: the same shape as the jev-sanity-demo's `warningsFor`.
 *
 * Three levels, one document-level rule each, each finding on the field it is
 * about:
 *   hold → error: Sanity disables Publish until someone sorts it out
 *   warn → warning
 *   tip  → info, a quiet note
 *
 * A comparison writes the snapshot to the draft, and that edit is what makes
 * the Studio run validation again with fresh results.
 *
 * When the text has changed since the comparison, earlier warnings and tips
 * may no longer apply, so they're held back behind one "compare again" note.
 * Earlier holds still show: editing a word shouldn't be a way around one.
 */
import type {ComparisonSnapshot} from './skillGate'
import {textHash} from './skillSignals'

export type ValidatedSkill = {
  description?: string
  content?: string
  metadata?: {comparison?: ComparisonSnapshot}
}

export type Marker = {message: string; path: string[]}

const AGAIN = 'Use “Compare again” at the top of the form.'

export async function comparisonMarkers(doc: ValidatedSkill | undefined, level: 'hold' | 'warn' | 'tip'): Promise<true | Marker[]> {
  if (!doc?.description) return true
  const snapshot = doc.metadata?.comparison
  if (!snapshot) {
    return level === 'warn'
      ? [{message: 'This skill hasn’t been compared with other skills yet. Use “Compare now” at the top of the form.', path: ['description']}]
      : true
  }

  const [descriptionHash, bodyHash] = await Promise.all([textHash(doc.description), textHash(doc.content ?? '')])
  const descriptionChanged = snapshot.descriptionHash !== descriptionHash
  const contentChanged = Boolean(snapshot.bodyHash) && snapshot.bodyHash !== bodyHash
  const stale = descriptionChanged || contentChanged

  const markers: Marker[] = []
  if (stale && level === 'warn') {
    markers.push(
      descriptionChanged
        ? {message: `You’ve changed the description since the last comparison with other skills. ${AGAIN}`, path: ['description']}
        : {message: `You’ve changed the content since the last comparison with other skills. ${AGAIN}`, path: ['content']},
    )
  }
  for (const finding of snapshot.findings ?? []) {
    if (finding.level !== level) continue
    if (stale && level !== 'hold') continue
    const text = [finding.message, finding.todo].filter(Boolean).join(' ')
    markers.push({
      message: stale ? `${text} (From the last comparison. ${AGAIN})` : text,
      path: [finding.field ?? 'description'],
    })
  }
  return markers.length ? markers : true
}
