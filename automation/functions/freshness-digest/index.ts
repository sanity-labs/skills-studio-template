import {scheduledEventHandler} from '@sanity/functions'
import {createClient} from '@sanity/client'
import {skillsConfig, STUDIO_URL} from '../../../studio/skills.config'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_REVIEW_DAYS = 90

type SkillRow = {
  _id: string
  skillName: string
  _updatedAt: string
  lastReviewedAt: string | null
  cadence: number
  owners: Array<{name: string | null; slackId: string | null} | null> | null
  legacyOwner: string | null
}

// Mirrors reviewOverdueDays in studio/components/reviewStatus.ts
function overdueDays(row: SkillRow): number | null {
  const anchor = row.lastReviewedAt || row._updatedAt
  if (!anchor) return null
  const ageDays = Math.floor((Date.now() - new Date(anchor).getTime()) / DAY_MS)
  return ageDays > (row.cadence || DEFAULT_REVIEW_DAYS) ? ageDays : null
}

export const handler = scheduledEventHandler(async ({context}) => {
  // Cron runs daily (day-of-week scheduling is unreliable, see blueprint);
  // only post the digest on Mondays.
  if (new Date().getUTCDay() !== 1) {
    console.log('Not Monday — skipping digest')
    return
  }
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) {
    console.error('SLACK_WEBHOOK_URL not set — skipping digest')
    return
  }

  const client = createClient({
    projectId: skillsConfig.sanity.projectId,
    dataset: skillsConfig.sanity.dataset,
    apiVersion: '2024-01-01',
    useCdn: false,
    token: context.clientOptions?.token,
  })

  const rows: SkillRow[] = await client.fetch(`*[_type == "skill" && !(_id in path("drafts.**"))]{
    _id, skillName, _updatedAt,
    "lastReviewedAt": metadata.lastReviewedAt,
    "cadence": coalesce(metadata.reviewEveryDays, ${DEFAULT_REVIEW_DAYS}),
    "owners": metadata.owners[]{name, slackId},
    "legacyOwner": metadata.owner
  }`)

  const overdue = rows
    .map((row) => ({row, days: overdueDays(row)}))
    .filter((e): e is {row: SkillRow; days: number} => e.days != null)
    .sort((a, b) => b.days - a.days)

  if (overdue.length === 0) {
    console.log('No overdue skills — nothing to post')
    return
  }

  // Group by owner mention; skills without any resolvable owner go last.
  const byOwner = new Map<string, Array<{row: SkillRow; days: number}>>()
  for (const entry of overdue) {
    const owners = (entry.row.owners || []).filter(Boolean) as Array<{
      name: string | null
      slackId: string | null
    }>
    const keys = owners.length
      ? owners.map((o) => (o.slackId ? `<@${o.slackId}>` : o.name || 'unowned'))
      : [entry.row.legacyOwner ? `${entry.row.legacyOwner} (legacy owner — claim it!)` : '_Unowned — adopt me_']
    for (const key of keys) {
      if (!byOwner.has(key)) byOwner.set(key, [])
      byOwner.get(key)!.push(entry)
    }
  }

  // An intent link, not a hand-built `/structure/...` path. A structure path
  // hard-codes the shape of the pane tree, so it breaks whenever that tree
  // changes — and these links outlive the digest, sitting in Slack history.
  // The root `/intent` route resolves to whichever pane claims the intent.
  const skillLine = ({row, days}: {row: SkillRow; days: number}) =>
    `  • <${STUDIO_URL}/intent/edit/id=${row._id};type=skill|${row.skillName}> — ${days}d since last review`

  const sections = [...byOwner.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([owner, entries]) => `${owner}\n${entries.map(skillLine).join('\n')}`)

  const text = [
    `:broom: *Skill freshness digest* — ${overdue.length} skill${overdue.length === 1 ? '' : 's'} past review cadence.`,
    `Open the skill, check it still reflects reality (especially policy/SOP content), then hit *Mark reviewed*.`,
    '',
    ...sections,
  ].join('\n')

  const res = await fetch(webhook, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text}),
  })
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`)
  }
  console.log(`Posted digest: ${overdue.length} overdue skills, ${byOwner.size} owner groups`)
})
