/**
 * What a good skill description does, as yes/no questions for Jev.
 *
 * Hard-coded for now; the shape is the one from the jev-sanity-demo, where
 * rules are documents editors write, so moving these into the dataset later
 * is a matter of reading them from a query instead of this array.
 *
 * The question wording was tried on all 124 skills on 2026-10-11 before it was
 * adopted: "explains how it works" flagged 20, with feature-request-triage
 * first (0.92) and well-scoped descriptions like product-launch at 0.03.
 * Rewording a question means checking the results again.
 */

export type DescriptionRule = {
  id: string
  /** Short label for stored results. */
  title: string
  question: string
  yes: string
  no: string
  /** Which answer is the problem. */
  failWhen: 'yes' | 'no'
  /** `tip` shows as a quiet note (info), `warn` as a warning. */
  severity: 'warn' | 'tip'
  /** What the author sees: what was found, why it matters, what to do. */
  message: string
  why: string
  todo: string
  /** One line for the fix prompt's list of what's wrong. */
  problem: string
}

const PICKING = 'AI assistants decide which skill to use by reading skill descriptions.'

export const DESCRIPTION_RULES: DescriptionRule[] = [
  {
    id: 'says_job',
    severity: 'warn',
    title: 'Says what it helps with',
    question:
      'Does skill.description say what problem the skill solves or what task it helps with, in words a person who needs it would recognize?',
    yes: 'States the job or problem in user terms.',
    no: 'Only names tools, systems or steps; the job is unclear.',
    failWhen: 'no',
    message: 'The description doesn’t say what problem this skill solves.',
    why: `${PICKING} People ask about their problem, so that’s what the AI looks for.`,
    todo: 'Start with what the skill helps people do, in their words.',
    problem: 'It doesn’t say what problem the skill solves or what task it helps with.',
  },
  {
    id: 'says_when',
    severity: 'warn',
    title: 'Says when to use it',
    question:
      'Does skill.description describe when to use the skill: situations people are in, or things they would ask or type?',
    yes: 'Names concrete situations or example requests.',
    no: 'No situations or example requests.',
    failWhen: 'no',
    message: 'The description doesn’t say when to use this skill.',
    why: 'Situations and example requests help the AI match what people ask to this skill.',
    todo: 'Add the situations people are in, or a few things they’d actually type, when they need it.',
    problem: 'It doesn’t say when to use the skill: no situations or example requests.',
  },
  {
    id: 'says_not_for',
    severity: 'tip',
    title: 'Says what it’s not for',
    question: 'Does skill.description say what the skill is not for, or name another skill to use instead?',
    yes: 'States an exclusion or points to another skill.',
    no: 'No exclusions.',
    failWhen: 'no',
    message: 'The description doesn’t say what this skill is not for.',
    why: `${PICKING} Without this, the AI can use this skill for requests that belong to a similar skill.`,
    todo: 'Add a sentence such as “Not for …; use [similar skill] instead.”',
    problem: 'It doesn’t say what the skill is not for.',
  },
  {
    id: 'explains_mechanics',
    severity: 'warn',
    title: 'Explains how it works instead of when to use it',
    question:
      'Is most of skill.description spent explaining how the skill works internally (its steps, tools, APIs, data sources, internal states or logs) rather than what it is for and when to use it?',
    yes: 'Mostly a walkthrough of how it works.',
    no: 'Mostly what it is for and when to use it; mechanics are brief or absent.',
    failWhen: 'yes',
    message: 'Most of the description explains how the skill works, not when to use it.',
    why: `${PICKING} Steps, tools and data sources don’t help them decide, and they crowd out what does.`,
    todo: 'Keep what the skill is for and when to use it. Move the steps into Content.',
    problem:
      'Most of it explains how the skill works (steps, tools, data sources). That belongs in the Content field; the description should say what it’s for and when to use it.',
  },
]

export const RULES_BY_ID = new Map(DESCRIPTION_RULES.map((rule) => [rule.id, rule]))

/** One Jev request: a noul per rule, keyed by rule id. */
export function descriptionRuleQuestions(rules: DescriptionRule[] = DESCRIPTION_RULES) {
  return Object.fromEntries(
    rules.map((rule) => [rule.id, {type: 'noul', instructions: rule.question, criteria: {true: rule.yes, false: rule.no}}]),
  )
}

/** The skill as the rules see it: `skill.description` is what each question names. */
export const descriptionRuleState = (skill: {skillName: string; description: string}) => ({
  skill: {name: skill.skillName, description: skill.description},
})

export type DescriptionCheck = {rule: string; title: string; probability: number; passed: boolean}

const THRESHOLD = 0.5

/** Turn Jev's answers into pass/fail per rule. A rule Jev didn't answer is left out, not passed. */
export function evaluateDescriptionRules(
  answers: Record<string, {noul?: number} | undefined>,
  rules: DescriptionRule[] = DESCRIPTION_RULES,
): DescriptionCheck[] {
  return rules.flatMap((rule) => {
    const probability = answers[rule.id]?.noul
    if (probability === undefined) return []
    const answeredYes = probability > THRESHOLD
    const failed = rule.failWhen === 'yes' ? answeredYes : !answeredYes
    return [{rule: rule.id, title: rule.title, probability, passed: !failed}]
  })
}
