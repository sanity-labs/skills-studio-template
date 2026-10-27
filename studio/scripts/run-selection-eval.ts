/**
 * Run selection evals against the real listing: which skill fires for each
 * trigger-kind `skillEval` row?
 *
 * The listing is what a user with those plugins actually sees — name and
 * description for every published skill in the same audiences as the skill under
 * test. Nothing loads a skill body, calls a tool, or touches a connector, so
 * this runs anywhere with an API key and costs one short completion per run.
 *
 *   cd studio
 *   # print the listing and cases without calling a model (free)
 *   npx sanity exec scripts/run-selection-eval.ts --with-user-token
 *
 *   # actually score them
 *   ANTHROPIC_API_KEY=… APPLY=1 npx sanity exec scripts/run-selection-eval.ts --with-user-token
 *
 * Options (env):
 *   SKILL=<name>    only rows filed under this skill (default: all trigger rows)
 *   MODEL=<id>      any id from utils/aiProviders.ts (default: claude-opus-4-8)
 *   RUNS=<n>        repeats per case (default: 3)
 *   SPLIT=dev|test  only rows carrying that tag
 *
 * Keys are read from the environment per provider: ANTHROPIC_API_KEY,
 * OPENAI_API_KEY, GEMINI_API_KEY.
 */
import {getCliClient} from 'sanity/cli'
import {generateText} from '../utils/aiProviders'
import {
  runSelectionEval,
  renderListing,
  buildSelectionSystemPrompt,
  type SkillListingEntry,
  type SelectionCase,
} from '../utils/runSelectionEval'

const apply = process.env.APPLY === '1'
const model = process.env.MODEL || 'claude-opus-4-8'
const runs = Number(process.env.RUNS || 3)
const onlySkill = process.env.SKILL
const split = process.env.SPLIT

const client = getCliClient({apiVersion: '2025-02-19', perspective: 'raw'})

type EvalRow = {
  _id: string
  prompt: string
  filedUnder?: string
  expectedSkill?: string
  expectNone?: boolean
  acceptableSkills?: string[]
  tags?: string[]
}

async function main() {
  const rows: EvalRow[] = await client.fetch(
    `*[_type == "skillEval" && kind == "trigger" && count(requiresConnectors) == 0
       && !(_id in path("drafts.**"))
       && ($skill == null || skill->skillName == $skill)]{
      _id, prompt, tags, expectNone,
      "filedUnder": skill->skillName,
      "expectedSkill": expectedSkill->skillName,
      "acceptableSkills": acceptableSkills[]->skillName
    }`,
    {skill: onlySkill ?? null},
  )

  const cases: SelectionCase[] = rows
    .filter((r) => !split || r.tags?.includes(split))
    .map((r) => ({
      _id: r._id,
      prompt: r.prompt,
      expectedSkill: r.expectedSkill,
      expectNone: r.expectNone,
      acceptableSkills: r.acceptableSkills,
    }))

  if (cases.length === 0) {
    console.log('No connector-free trigger rows match. Seed some first:')
    console.log('  npx sanity exec scripts/seed-selection-evals.ts --with-user-token')
    return
  }

  // The listing a user of these skills' audiences would see.
  const audiences: string[] = await client.fetch(
    `array::unique(*[_type == "skill" && skillName in $names].audiences[]->slug.current)`,
    {names: [...new Set(rows.map((r) => r.filedUnder).filter(Boolean))]},
  )
  const listing: SkillListingEntry[] = await client.fetch(
    `*[_type == "skill" && !(_id in path("drafts.**")) && defined(description)
       && count((audiences[]->slug.current)[@ in $audiences]) > 0]
     | order(skillName asc){skillName, description}`,
    {audiences},
  )

  const listingChars = listing.reduce((n, e) => n + e.skillName.length + e.description.length + 4, 0)
  console.log(`Listing: ${listing.length} skills, ${listingChars.toLocaleString()} chars`)
  console.log(`Cases:   ${cases.length}${split ? ` (split=${split})` : ''}`)
  console.log(`Model:   ${model} × ${runs} runs = ${cases.length * runs} calls\n`)

  if (!apply) {
    console.log('--- system prompt ---')
    console.log(buildSelectionSystemPrompt(renderListing(listing)).slice(0, 1200) + '\n  …')
    console.log('\n--- cases ---')
    for (const c of cases) {
      const want = c.expectNone ? 'NONE' : [c.expectedSkill, ...(c.acceptableSkills ?? [])].join(' | ')
      console.log(`  ${want.padEnd(42)} ${c.prompt.slice(0, 70)}`)
    }
    console.log('\nDry run — no model calls made. Re-run with APPLY=1 and a key to score.')
    return
  }

  const secrets = {
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
  }

  const {results, summary} = await runSelectionEval({
    cases,
    listing,
    runs,
    generate: ({system, user}) => generateText({model, system, user, maxTokens: 64, secrets}),
  })

  console.log('--- results ---')
  for (const r of results) {
    const mark = r.passed ? '✓' : '✗'
    const agree = r.unanimous ? '' : `  (split: ${r.answers.join(', ')})`
    console.log(`${mark} ${r.passedRuns}/${r.runs}  want ${r.expected} · got ${r.answer}${agree}`)
    console.log(`    ${r.prompt.slice(0, 90)}`)
    if (r.unrecognized.length) console.log(`    ! not in listing: ${r.unrecognized.join(', ')}`)
    if (r.errors.length) console.log(`    ! ${r.errors.join('; ')}`)
  }

  console.log(
    `\ncases ${summary.passed}/${summary.total} (${Math.round(summary.passRate * 100)}%)` +
      ` · runs ${summary.passedRuns}/${summary.totalRuns} (${Math.round(summary.runPassRate * 100)}%)` +
      ` · unanimous ${summary.unanimousCases}/${summary.total}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
