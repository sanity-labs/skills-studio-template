/**
 * Selection evals: which skill fires for a given request.
 *
 * The agent sees only skill names and descriptions until one is loaded, so
 * selection is decided entirely by the description — this module measures that
 * and nothing else. It never loads a skill body, calls a tool, or reaches a
 * connector, which is why it can run on every publish for pennies.
 *
 * Two deliberate constraints:
 *
 *  - **Nothing agent-specific.** The same skills ship to several harnesses
 *    (`.claude-plugin/` and `.cursor-plugin/` marketplaces), so the prompt names
 *    no agent and the listing's rendering is a parameter — a harness that
 *    formats its listing differently passes its own `renderListing`.
 *  - **Nothing provider-specific.** `generate` is injected. Adapt
 *    `utils/aiProviders.ts` at the call site to score on Claude, GPT or Gemini;
 *    record which one on the run, since a result only means something next to
 *    the model and harness that produced it.
 *
 * This is what `aiProviders.ts` cannot do on its own: it sends one user message
 * with no siblings, so it can grade an answer but never which skill was chosen.
 */

/** Answer meaning "no skill should handle this". */
export const NO_SKILL = 'NONE'

export type SkillListingEntry = {
  skillName: string
  description: string
  /** Plugin folders the skill ships in. Unused by the default renderer. */
  folders?: string[]
}

export type SelectionCase = {
  /** `_id` of the `skillEval` document, for reporting back. */
  _id: string
  prompt: string
  /** Skill name that should fire. */
  expectedSkill?: string | null
  /** Correct answer is that no skill fires. */
  expectNone?: boolean
  /** Other names that also count as correct. */
  acceptableSkills?: string[]
}

export type SelectionResult = {
  caseId: string
  prompt: string
  /** What the expectation was, for display. */
  expected: string
  /** One entry per run: a skill name, NO_SKILL, or null when unusable. */
  answers: Array<string | null>
  /** The most common answer across runs. */
  answer: string | null
  /** How many runs were graded correct. */
  passedRuns: number
  runs: number
  /** True when a majority of runs were correct. */
  passed: boolean
  /** True when every run gave the same answer, right or wrong. */
  unanimous: boolean
  /** Names returned that are not in the listing. */
  unrecognized: string[]
  /** Provider errors, one per failed run. */
  errors: string[]
}

export type SelectionSummary = {
  total: number
  passed: number
  failed: number
  passRate: number
  totalRuns: number
  passedRuns: number
  runPassRate: number
  unanimousCases: number
}

export type Generate = (args: {system: string; user: string}) => Promise<string>

export type RunSelectionEvalOptions = {
  cases: SelectionCase[]
  listing: SkillListingEntry[]
  generate: Generate
  /** Repeats per case. Disagreement across runs is itself a finding. */
  runs?: number
  renderListing?: (entries: SkillListingEntry[]) => string
}

/**
 * One line per skill, full description.
 *
 * Descriptions are never truncated: the sentence that separates a skill from
 * its sibling ("not for invoices; use billing-lookup") sits at the end, so a
 * clipped listing removes exactly the part that does the work.
 */
export function renderListing(entries: SkillListingEntry[]): string {
  return entries.map((e) => `- ${e.skillName}: ${e.description.trim().replace(/\s+/g, ' ')}`).join('\n')
}

export function buildSelectionSystemPrompt(listing: string): string {
  return [
    'You route a request to one skill, or to none.',
    '',
    'Available skills:',
    listing,
    '',
    `Reply with exactly one skill name from the list above, or ${NO_SKILL} if the`,
    'request needs no skill and is better answered directly.',
    'Reply with the name only — no explanation, no punctuation, no formatting.',
  ].join('\n')
}

/** Strip formatting a model wraps a name in, and any plugin prefix. */
function normalize(token: string): string {
  return token
    .trim()
    .replace(/^[`'"*\s]+|[`'"*\s.,;:!?]+$/g, '')
    .replace(/^[a-z0-9-]+:/i, '')
    .toLowerCase()
}

type Parsed = {answer: string | null; unrecognized?: string}

/**
 * Read a skill name out of the reply.
 *
 * Prefers an exact match on the whole reply; falls back to scanning tokens so a
 * model that adds prose still scores. A reply naming nothing known returns null
 * and reports the token, so a hallucinated name is never silently a miss.
 */
function parseAnswer(raw: string, known: Map<string, string>): Parsed {
  const whole = normalize(raw)
  if (whole === NO_SKILL.toLowerCase()) return {answer: NO_SKILL}
  if (known.has(whole)) return {answer: known.get(whole)!}

  const tokens = raw.split(/[\s,()[\]]+/).filter(Boolean)
  for (const token of tokens) {
    const t = normalize(token)
    if (t === NO_SKILL.toLowerCase()) return {answer: NO_SKILL}
    if (known.has(t)) return {answer: known.get(t)!}
  }

  // Nothing known. Report the first plausible-looking token, if any.
  const candidate = tokens.map(normalize).find((t) => /^[a-z0-9][a-z0-9-]{2,}$/.test(t))
  return {answer: null, unrecognized: candidate}
}

function describeExpectation(c: SelectionCase): string {
  if (c.expectNone) return NO_SKILL
  const names = [c.expectedSkill, ...(c.acceptableSkills ?? [])].filter(Boolean) as string[]
  return names.join(' | ')
}

function modal(answers: Array<string | null>): string | null {
  const counts = new Map<string, number>()
  for (const a of answers) {
    if (a === null) continue
    counts.set(a, (counts.get(a) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [a, n] of counts) {
    if (n > bestN) {
      best = a
      bestN = n
    }
  }
  return best
}

export async function runSelectionEval(
  opts: RunSelectionEvalOptions,
): Promise<{results: SelectionResult[]; summary: SelectionSummary}> {
  const {cases, listing, generate} = opts
  const runs = opts.runs ?? 3
  const render = opts.renderListing ?? renderListing

  if (listing.length === 0) {
    throw new Error('runSelectionEval: listing is empty — there is nothing to select from.')
  }
  for (const c of cases) {
    if (!c.expectNone && !c.expectedSkill) {
      throw new Error(
        `runSelectionEval: case ${c._id} states no expectation — set expectedSkill or expectNone.`,
      )
    }
  }

  const known = new Map(listing.map((e) => [e.skillName.toLowerCase(), e.skillName]))
  const system = buildSelectionSystemPrompt(render(listing))

  const results: SelectionResult[] = []

  for (const c of cases) {
    const accepted = new Set(
      [c.expectedSkill, ...(c.acceptableSkills ?? [])]
        .filter(Boolean)
        .map((n) => (n as string).toLowerCase()),
    )

    const answers: Array<string | null> = []
    const unrecognized: string[] = []
    const errors: string[] = []
    let passedRuns = 0

    for (let i = 0; i < runs; i++) {
      let parsed: Parsed
      try {
        parsed = parseAnswer(await generate({system, user: c.prompt}), known)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
        answers.push(null)
        continue
      }

      answers.push(parsed.answer)
      if (parsed.unrecognized && !unrecognized.includes(parsed.unrecognized)) {
        unrecognized.push(parsed.unrecognized)
      }

      const correct = c.expectNone
        ? parsed.answer === NO_SKILL
        : parsed.answer !== null && accepted.has(parsed.answer.toLowerCase())
      if (correct) passedRuns++
    }

    results.push({
      caseId: c._id,
      prompt: c.prompt,
      expected: describeExpectation(c),
      answers,
      answer: modal(answers),
      passedRuns,
      runs,
      passed: passedRuns * 2 > runs,
      unanimous: answers.every((a) => a === answers[0]),
      unrecognized,
      errors,
    })
  }

  const passed = results.filter((r) => r.passed).length
  const passedRuns = results.reduce((n, r) => n + r.passedRuns, 0)
  const totalRuns = results.reduce((n, r) => n + r.runs, 0)

  return {
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length === 0 ? 0 : passed / results.length,
      totalRuns,
      passedRuns,
      runPassRate: totalRuns === 0 ? 0 : passedRuns / totalRuns,
      unanimousCases: results.filter((r) => r.unanimous).length,
    },
  }
}
