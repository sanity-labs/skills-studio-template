import {describe, it, expect} from 'vitest'
import {
  NO_SKILL,
  renderListing,
  buildSelectionSystemPrompt,
  runSelectionEval,
  type SkillListingEntry,
  type SelectionCase,
} from '../runSelectionEval'

const LISTING: SkillListingEntry[] = [
  {
    skillName: 'bigquery-mcp',
    description: "The company's business analyst skill. ARR, pipeline, funnel, usage.",
    folders: ['org-skills'],
  },
  {
    skillName: 'billing-lookup',
    description: "One customer's invoices, charges, plan, quotas and arrears.",
    folders: ['field', 'finance'],
  },
  {
    skillName: 'data-analytics-at-acme',
    description: 'Where a dashboard lives, how a metric is defined, how to add tracking.',
    folders: ['org-skills'],
  },
]

/** Replays a fixed sequence of model answers, one per call. */
function scriptedGenerate(...answers: string[]) {
  let i = 0
  const calls: Array<{system: string; user: string}> = []
  const generate = async (args: {system: string; user: string}) => {
    calls.push(args)
    return answers[Math.min(i++, answers.length - 1)]
  }
  return {generate, calls}
}

const caseOf = (over: Partial<SelectionCase> = {}): SelectionCase => ({
  _id: 'e1',
  prompt: 'what is our current ARR?',
  expectedSkill: 'bigquery-mcp',
  ...over,
})

describe('renderListing', () => {
  it('renders one line per skill with its full description', () => {
    const out = renderListing(LISTING)
    expect(out).toContain('bigquery-mcp:')
    expect(out).toContain('ARR, pipeline, funnel, usage.')
    expect(out.trim().split('\n')).toHaveLength(3)
  })

  it('keeps whole descriptions — boundary sentences live at the end', () => {
    const long = 'Does a thing. Use when asked. Not for invoices; use billing-lookup.'
    const out = renderListing([{skillName: 'x', description: long}])
    expect(out).toContain('use billing-lookup.')
  })

  it('is replaceable, because listing format is harness-specific', () => {
    const {generate, calls} = scriptedGenerate('bigquery-mcp')
    return runSelectionEval({
      cases: [caseOf()],
      listing: LISTING,
      generate,
      runs: 1,
      renderListing: (entries) => entries.map((e) => `<<${e.skillName}>>`).join('\n'),
    }).then(() => {
      expect(calls[0].system).toContain('<<bigquery-mcp>>')
      expect(calls[0].system).not.toContain('ARR, pipeline')
    })
  })
})

describe('buildSelectionSystemPrompt', () => {
  it('carries names and descriptions, never a skill body', () => {
    const prompt = buildSelectionSystemPrompt(renderListing(LISTING))
    expect(prompt).toContain('billing-lookup')
    expect(prompt).toContain(NO_SKILL)
  })

  it('names no particular agent — skills ship to several harnesses', () => {
    const prompt = buildSelectionSystemPrompt(renderListing(LISTING))
    expect(prompt).not.toMatch(/claude|cursor|anthropic|gpt|gemini/i)
  })
})

describe('runSelectionEval — grading', () => {
  it('passes when the answer is the expected skill', async () => {
    const {generate} = scriptedGenerate('bigquery-mcp')
    const {results, summary} = await runSelectionEval({
      cases: [caseOf()],
      listing: LISTING,
      generate,
      runs: 1,
    })
    expect(results[0].passed).toBe(true)
    expect(results[0].answers).toEqual(['bigquery-mcp'])
    expect(summary.passRate).toBe(1)
  })

  it('fails when a sibling wins — the case this whole exercise is about', async () => {
    const {generate} = scriptedGenerate('bigquery-mcp')
    const {results} = await runSelectionEval({
      cases: [
        caseOf({
          _id: 'near-miss',
          prompt: 'how much was org ab1Cd2Ef charged on their last invoice?',
          expectedSkill: 'billing-lookup',
        }),
      ],
      listing: LISTING,
      generate,
      runs: 1,
    })
    expect(results[0].passed).toBe(false)
    expect(results[0].answer).toBe('bigquery-mcp')
    expect(results[0].expected).toBe('billing-lookup')
  })

  it('accepts any of acceptableSkills', async () => {
    const {generate} = scriptedGenerate('data-analytics-at-acme')
    const {results} = await runSelectionEval({
      cases: [caseOf({acceptableSkills: ['data-analytics-at-acme']})],
      listing: LISTING,
      generate,
      runs: 1,
    })
    expect(results[0].passed).toBe(true)
  })

  it('handles expectNone — firing a skill at everything is its own failure', async () => {
    const none = scriptedGenerate(NO_SKILL)
    const wrong = scriptedGenerate('bigquery-mcp')

    const ok = await runSelectionEval({
      cases: [caseOf({expectedSkill: undefined, expectNone: true})],
      listing: LISTING,
      generate: none.generate,
      runs: 1,
    })
    const bad = await runSelectionEval({
      cases: [caseOf({expectedSkill: undefined, expectNone: true})],
      listing: LISTING,
      generate: wrong.generate,
      runs: 1,
    })

    expect(ok.results[0].passed).toBe(true)
    expect(bad.results[0].passed).toBe(false)
  })
})

describe('runSelectionEval — parsing model answers', () => {
  const parses = async (raw: string) => {
    const {generate} = scriptedGenerate(raw)
    const {results} = await runSelectionEval({
      cases: [caseOf()],
      listing: LISTING,
      generate,
      runs: 1,
    })
    return results[0].answer
  }

  it('strips backticks, quotes and trailing punctuation', async () => {
    expect(await parses('`bigquery-mcp`')).toBe('bigquery-mcp')
    expect(await parses('"bigquery-mcp"')).toBe('bigquery-mcp')
    expect(await parses('bigquery-mcp.')).toBe('bigquery-mcp')
  })

  it('strips a plugin prefix', async () => {
    expect(await parses('org-skills:bigquery-mcp')).toBe('bigquery-mcp')
  })

  it('is case-insensitive', async () => {
    expect(await parses('BigQuery-MCP')).toBe('bigquery-mcp')
  })

  it('finds the name even when the model adds prose', async () => {
    expect(await parses('I would load bigquery-mcp for this.')).toBe('bigquery-mcp')
  })

  it('reports a name that is not in the listing rather than crediting it', async () => {
    const {generate} = scriptedGenerate('sanity-brand-kit')
    const {results} = await runSelectionEval({
      cases: [caseOf()],
      listing: LISTING,
      generate,
      runs: 1,
    })
    expect(results[0].passed).toBe(false)
    expect(results[0].unrecognized).toContain('sanity-brand-kit')
  })

  it('treats an empty or unusable reply as no answer, not as NONE', async () => {
    const {generate} = scriptedGenerate('   ')
    const {results} = await runSelectionEval({
      cases: [caseOf({expectedSkill: undefined, expectNone: true})],
      listing: LISTING,
      generate,
      runs: 1,
    })
    // A blank reply must not be scored as a correct "no skill" answer.
    expect(results[0].passed).toBe(false)
  })
})

describe('runSelectionEval — repeated runs', () => {
  it('defaults to 3 runs per case', async () => {
    const {generate, calls} = scriptedGenerate('bigquery-mcp')
    await runSelectionEval({cases: [caseOf()], listing: LISTING, generate})
    expect(calls).toHaveLength(3)
  })

  it('scores each run, and passes the case on a majority', async () => {
    const {generate} = scriptedGenerate('bigquery-mcp', 'billing-lookup', 'bigquery-mcp')
    const {results} = await runSelectionEval({
      cases: [caseOf()],
      listing: LISTING,
      generate,
      runs: 3,
    })
    expect(results[0].passedRuns).toBe(2)
    expect(results[0].passed).toBe(true)
    expect(results[0].unanimous).toBe(false)
    expect(results[0].answer).toBe('bigquery-mcp')
  })

  it('flags disagreement — an unstable description is itself the finding', async () => {
    const agree = scriptedGenerate('bigquery-mcp', 'bigquery-mcp', 'bigquery-mcp')
    const split = scriptedGenerate('bigquery-mcp', 'billing-lookup', 'data-analytics-at-acme')

    const a = await runSelectionEval({cases: [caseOf()], listing: LISTING, generate: agree.generate})
    const b = await runSelectionEval({cases: [caseOf()], listing: LISTING, generate: split.generate})

    expect(a.results[0].unanimous).toBe(true)
    expect(b.results[0].unanimous).toBe(false)
    expect(b.summary.unanimousCases).toBe(0)
  })

  it('fails the case when no answer holds a majority', async () => {
    const {generate} = scriptedGenerate('bigquery-mcp', 'billing-lookup', 'data-analytics-at-acme')
    const {results} = await runSelectionEval({
      cases: [caseOf()],
      listing: LISTING,
      generate,
      runs: 3,
    })
    expect(results[0].passedRuns).toBe(1)
    expect(results[0].passed).toBe(false)
  })
})

describe('runSelectionEval — summary', () => {
  it('reports per-run and per-case totals separately', async () => {
    const {generate} = scriptedGenerate('bigquery-mcp')
    const {summary} = await runSelectionEval({
      cases: [caseOf({_id: 'a'}), caseOf({_id: 'b', expectedSkill: 'billing-lookup'})],
      listing: LISTING,
      generate,
      runs: 3,
    })
    expect(summary.total).toBe(2)
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.totalRuns).toBe(6)
    expect(summary.passedRuns).toBe(3)
  })

  it('survives a provider error on one case without losing the rest', async () => {
    let n = 0
    const generate = async () => {
      if (++n === 1) throw new Error('429 rate limited')
      return 'bigquery-mcp'
    }
    const {results, summary} = await runSelectionEval({
      cases: [caseOf({_id: 'a'}), caseOf({_id: 'b'})],
      listing: LISTING,
      generate,
      runs: 1,
    })
    expect(results[0].passed).toBe(false)
    expect(results[0].errors[0]).toMatch(/429/)
    expect(results[1].passed).toBe(true)
    expect(summary.total).toBe(2)
  })
})

describe('runSelectionEval — input validation', () => {
  it('refuses an empty listing: there is nothing to select from', async () => {
    const {generate} = scriptedGenerate('x')
    await expect(
      runSelectionEval({cases: [caseOf()], listing: [], generate}),
    ).rejects.toThrow(/listing/i)
  })

  it('refuses a case that states no expectation', async () => {
    const {generate} = scriptedGenerate('x')
    await expect(
      runSelectionEval({
        cases: [caseOf({expectedSkill: undefined, expectNone: false})],
        listing: LISTING,
        generate,
      }),
    ).rejects.toThrow(/e1.*expect/i)
  })
})
