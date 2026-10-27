import {describe, it, expect} from 'vitest'
import {fromEvalQueriesJson} from '../evalQueries'

const OPTS = {skillId: 'skill-abc', skillName: 'marketing-web-analytics'}

describe('fromEvalQueriesJson', () => {
  it('maps a positive trigger eval to expectedSkill = this skill', () => {
    const [row] = fromEvalQueriesJson(
      {trigger_evals: [{query: 'is 62 users out of 120k enough?', should_trigger: true}]},
      OPTS,
    )

    expect(row).toMatchObject({
      _type: 'skillEval',
      kind: 'trigger',
      prompt: 'is 62 users out of 120k enough?',
      skill: {_type: 'reference', _ref: 'skill-abc'},
      expectedSkill: {_type: 'reference', _ref: 'skill-abc'},
    })
    expect(row.expectNone).toBeUndefined()
    expect(row.needsExpectation).toBeUndefined()
  })

  it('maps a negative trigger eval to expectNone AND flags it for a human', () => {
    // The format only says "not this one" — never which sibling should have
    // fired. That distinction is the whole point of the exercise, so an
    // imported negative is not a finished row.
    const [row] = fromEvalQueriesJson(
      {trigger_evals: [{query: "what's our current ARR?", should_trigger: false}]},
      OPTS,
    )

    expect(row.expectNone).toBe(true)
    expect(row.needsExpectation).toBe(true)
    expect(row.expectedSkill).toBeUndefined()
  })

  it('distinguishes an imported negative from a deliberate "nothing should fire"', () => {
    const [imported] = fromEvalQueriesJson(
      {trigger_evals: [{query: 'x', should_trigger: false}]},
      OPTS,
    )
    // expectNone alone is a legitimate final state; needsExpectation is what
    // separates "we decided" from "we don't know yet".
    expect(imported.expectNone).toBe(true)
    expect(imported.needsExpectation).toBe(true)
  })

  it('maps behavioral evals to kind=behavior with expectations', () => {
    const [row] = fromEvalQueriesJson(
      {
        behavioral_evals: [
          {
            skills: ['marketing-web-analytics'],
            query: 'Is a 15% sample too small?',
            expected_behavior: ['Separates statistical power from representativeness', 'Scopes the claim'],
          },
        ],
      },
      OPTS,
    )

    expect(row).toMatchObject({
      kind: 'behavior',
      prompt: 'Is a 15% sample too small?',
      expectations: [
        'Separates statistical power from representativeness',
        'Scopes the claim',
      ],
    })
    expect(row.expectedSkill).toBeUndefined()
    expect(row.expectNone).toBeUndefined()
  })

  it('defaults requiresConnectors to empty — the format carries no connector info', () => {
    const rows = fromEvalQueriesJson(
      {
        trigger_evals: [{query: 'a', should_trigger: true}],
        behavioral_evals: [{query: 'b', expected_behavior: ['c']}],
      },
      OPTS,
    )

    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.requiresConnectors).toEqual([])
  })

  it('imports both sections together, triggers first', () => {
    const rows = fromEvalQueriesJson(
      {
        trigger_evals: [
          {query: 't1', should_trigger: true},
          {query: 't2', should_trigger: false},
        ],
        behavioral_evals: [{query: 'b1', expected_behavior: ['x']}],
      },
      OPTS,
    )

    expect(rows.map((r) => r.kind)).toEqual(['trigger', 'trigger', 'behavior'])
  })

  it('accepts a file with only one section, or neither', () => {
    expect(fromEvalQueriesJson({trigger_evals: []}, OPTS)).toEqual([])
    expect(fromEvalQueriesJson({}, OPTS)).toEqual([])
  })

  it('tags imported rows so their provenance is queryable', () => {
    const [row] = fromEvalQueriesJson({trigger_evals: [{query: 'a', should_trigger: true}]}, OPTS)
    expect(row.tags).toContain('imported')
  })

  describe('rejects malformed input with a message naming the offender', () => {
    it('non-object input', () => {
      expect(() => fromEvalQueriesJson(null, OPTS)).toThrow(/must be a JSON object/)
      expect(() => fromEvalQueriesJson('[]', OPTS)).toThrow(/must be a JSON object/)
    })

    it('trigger_evals not an array', () => {
      expect(() => fromEvalQueriesJson({trigger_evals: {}}, OPTS)).toThrow(
        /trigger_evals must be an array/,
      )
    })

    it('missing query, naming the index', () => {
      expect(() =>
        fromEvalQueriesJson({trigger_evals: [{should_trigger: true}]}, OPTS),
      ).toThrow(/trigger_evals\[0\].*query/)
    })

    it('non-boolean should_trigger, naming the index', () => {
      expect(() =>
        fromEvalQueriesJson(
          {trigger_evals: [{query: 'a', should_trigger: true}, {query: 'b', should_trigger: 'yes'}]},
          OPTS,
        ),
      ).toThrow(/trigger_evals\[1\].*should_trigger/)
    })

    it('behavioral eval with no expected_behavior', () => {
      expect(() =>
        fromEvalQueriesJson({behavioral_evals: [{query: 'a'}]}, OPTS),
      ).toThrow(/behavioral_evals\[0\].*expected_behavior/)
    })
  })

  it('imports the real marketing-web-analytics fixture shape', () => {
    // 20 trigger rows + 3 behaviour rows, per the file shipped with that skill.
    const json = {
      trigger_evals: Array.from({length: 20}, (_, i) => ({
        query: `q${i}`,
        should_trigger: i < 10,
      })),
      behavioral_evals: Array.from({length: 3}, (_, i) => ({
        skills: ['marketing-web-analytics'],
        query: `b${i}`,
        expected_behavior: ['does the thing'],
      })),
    }

    const rows = fromEvalQueriesJson(json, OPTS)

    expect(rows.filter((r) => r.kind === 'trigger')).toHaveLength(20)
    expect(rows.filter((r) => r.kind === 'behavior')).toHaveLength(3)
    expect(rows.filter((r) => r.needsExpectation)).toHaveLength(10)
  })
})
