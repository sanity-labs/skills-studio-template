/**
 * Run the overlap check for one skill from the terminal — the same check the
 * Studio's "Check overlap" action runs, on the draft if there is one.
 *
 * Dry run (default) prints what it found. APPLY=1 saves the results to
 * `skillRelation` / `skillQuality` and the snapshot under the skill's
 * `metadata.comparison`, as the Studio does.
 *
 *   cd studio
 *   SKILL=my-skill OPENROUTER_API_KEY=… npx sanity exec scripts/check-overlap.ts --with-user-token
 *   APPLY=1 SKILL=my-skill OPENROUTER_API_KEY=… npx sanity exec scripts/check-overlap.ts --with-user-token
 */
import {getCliClient} from 'sanity/cli'
import {decide} from '../utils/jev'
import {runOverlapCheck} from '../utils/overlapCheck'
import {loadCheckInput, saveCheckResult, type CheckedSkill} from '../utils/overlapCheckData'

const apply = process.env.APPLY === '1'
const skillName = process.env.SKILL
const apiKey = process.env.OPENROUTER_API_KEY
if (!skillName) throw new Error('Set SKILL to the skill name to check, e.g. SKILL=my-skill.')
if (!apiKey) throw new Error('Set OPENROUTER_API_KEY.')

const client = getCliClient({apiVersion: 'v2025-02-19'})

async function main() {
  // Drafts perspective: the draft when there is one, else the published skill.
  const current = await client
    .withConfig({perspective: 'drafts'})
    .fetch<CheckedSkill | null>(`*[_type == "skill" && skillName == $name][0]{_id, skillName, title, description, content}`, {
      name: skillName,
    })
  if (!current) throw new Error(`No skill named "${skillName}".`)

  const {input, embeddingError} = await loadCheckInput(client, current)
  if (embeddingError) console.warn(`Embedding neighbours unavailable: ${embeddingError}`)
  console.log(`${input.rows.length} trigger rows, ${input.candidates.length} candidates\n`)

  const result = await runOverlapCheck(input, {
    decide: (state, questions) => decide({apiKey: apiKey!, state, questions}),
    now: () => new Date().toISOString(),
    onProgress: (message) => console.log(`… ${message}`),
  })

  console.log(`\n${result.quality.summary}\n`)
  for (const miss of result.quality.routing?.misses ?? []) {
    console.log(`  miss: wanted ${miss.expected}, got ${miss.chose} (${miss.confidence.toFixed(2)})  "${miss.prompt.slice(0, 80)}"`)
  }
  console.log('')
  for (const relation of result.relations) console.log(`  ${relation.summary}\n`)
  console.log(`Cost $${result.cost.toFixed(4)}`)

  if (!apply) {
    console.log('Dry run — nothing saved. Re-run with APPLY=1 to save.')
    return
  }
  const gate = await saveCheckResult(client, result, current.skillName ?? skillName!)
  console.log(`Saved ${result.relations.length} relations, the results doc and the snapshot on the skill (status: ${gate.level}).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
