import type {DocumentBadgeComponent} from 'sanity'

const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_REVIEW_DAYS = 90

/**
 * A skill is overdue when its last review (falling back to its last edit)
 * is older than its review cadence. Shared by the Studio badge, the Skill
 * Explorer chip, and mirrored in GROQ by the freshness digest function.
 */
export function reviewOverdueDays(doc: {
  _updatedAt?: string
  metadata?: {lastReviewedAt?: string | null; reviewEveryDays?: number | null} | null
}): number | null {
  const anchor = doc.metadata?.lastReviewedAt || doc._updatedAt
  if (!anchor) return null
  const cadence = doc.metadata?.reviewEveryDays || DEFAULT_REVIEW_DAYS
  const ageDays = Math.floor((Date.now() - new Date(anchor).getTime()) / DAY_MS)
  return ageDays > cadence ? ageDays : null
}

export const ReviewOverdueBadge: DocumentBadgeComponent = (props) => {
  const published = props.published as any
  if (!published) return null
  const overdue = reviewOverdueDays(published)
  if (overdue == null) return null
  return {
    label: `Review overdue (${overdue}d)`,
    title: 'Older than its review cadence — use "Mark reviewed" after checking it over',
    color: 'warning',
  }
}
