/**
 * Import `eval-queries.json` — one authoring tool's convention for shipping
 * eval cases alongside a skill. Claude's skill-authoring flow writes it into a
 * skill's `references/` folder; other tools have their own conventions or none.
 *
 * What it produces is deliberately harness-neutral: a prompt, and which skill
 * should answer it. Skills in this repo ship from one source to several
 * harnesses (`.claude-plugin/` and `.cursor-plugin/` marketplaces), so an eval
 * row must not assume the agent that will run it. Where a run happened — which
 * harness, which model — belongs on `skillEvalRun`, not here.
 *
 * Shape (as emitted by that flow, e.g. the marketing-web-analytics skill):
 *
 *   {
 *     "trigger_evals":    [{ "query": "...", "should_trigger": true }],
 *     "behavioral_evals": [{ "skills": ["name"], "query": "...",
 *                            "expected_behavior": ["...", "..."] }]
 *   }
 *
 * Import only, deliberately. Nothing reads this format at run time — the plugin
 * eval harness takes `case.yaml`, or `prompt.md` + `graders/*.md` — so writing
 * it back would add a managed path to the GitHub sync and leave an unnamed
 * reference file in every skill folder, which is an anti-pattern the skills
 * review flags. See IMPLEMENTATION_PLAN.md, Stage 4, item 4.
 */

export type ImportedSkillEval = {
  _type: 'skillEval'
  skill: {_type: 'reference'; _ref: string}
  kind: 'trigger' | 'behavior'
  prompt: string
  /** Which skill should fire. Trigger rows only. */
  expectedSkill?: {_type: 'reference'; _ref: string}
  /** Correct answer is "no skill fires". */
  expectNone?: true
  /** Set on import when we know it isn't this skill but not which one it is. */
  needsExpectation?: true
  /** Behaviour rows only. */
  expectations?: string[]
  requiresConnectors: string[]
  tags: string[]
}

export type ImportOptions = {
  /** `_id` of the skill these rows belong to. */
  skillId: string
  /** `skillName`, used to read `behavioral_evals[].skills`. */
  skillName: string
}

const FILE = 'eval-queries.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readArray(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error(`${FILE}: ${key} must be an array, got ${typeof value}.`)
  }
  return value
}

function readString(entry: Record<string, unknown>, key: string, where: string): string {
  const value = entry[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${FILE}: ${where} is missing a non-empty "${key}".`)
  }
  return value
}

function readEntry(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${FILE}: ${where} must be an object, got ${typeof value}.`)
  }
  return value
}

/**
 * Parse an `eval-queries.json` payload into draft `skillEval` documents.
 *
 * Throws with the offending path (e.g. `trigger_evals[3]`) rather than skipping
 * bad rows — a silently short import looks like a passing one.
 */
export function fromEvalQueriesJson(raw: unknown, opts: ImportOptions): ImportedSkillEval[] {
  if (!isRecord(raw)) {
    throw new Error(`${FILE} must be a JSON object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`)
  }

  const skillRef = {_type: 'reference' as const, _ref: opts.skillId}
  const rows: ImportedSkillEval[] = []

  readArray(raw, 'trigger_evals').forEach((item, i) => {
    const where = `trigger_evals[${i}]`
    const entry = readEntry(item, where)
    const prompt = readString(entry, 'query', where)

    if (typeof entry.should_trigger !== 'boolean') {
      throw new Error(`${FILE}: ${where} is missing a boolean "should_trigger".`)
    }

    const row: ImportedSkillEval = {
      _type: 'skillEval',
      skill: skillRef,
      kind: 'trigger',
      prompt,
      requiresConnectors: [],
      tags: ['imported'],
    }

    if (entry.should_trigger) {
      row.expectedSkill = skillRef
    } else {
      // The format says only "not this skill" — never which sibling should have
      // fired instead. Land it as expectNone so it is runnable, and flag it so
      // it reads as unfinished: `expectNone` on its own is a legitimate final
      // state ("nothing should fire here"), and the two must stay tellable
      // apart.
      row.expectNone = true
      row.needsExpectation = true
    }

    rows.push(row)
  })

  readArray(raw, 'behavioral_evals').forEach((item, i) => {
    const where = `behavioral_evals[${i}]`
    const entry = readEntry(item, where)
    const prompt = readString(entry, 'query', where)

    const behaviors = readArray(entry, 'expected_behavior')
    if (behaviors.length === 0) {
      throw new Error(`${FILE}: ${where} is missing a non-empty "expected_behavior".`)
    }

    const expectations = behaviors.map((behavior, j) => {
      if (typeof behavior !== 'string' || behavior.trim() === '') {
        throw new Error(`${FILE}: ${where}.expected_behavior[${j}] must be a non-empty string.`)
      }
      return behavior
    })

    rows.push({
      _type: 'skillEval',
      skill: skillRef,
      kind: 'behavior',
      prompt,
      expectations,
      requiresConnectors: [],
      tags: ['imported'],
    })
  })

  return rows
}
