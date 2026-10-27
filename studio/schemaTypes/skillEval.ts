import {defineType, defineField} from 'sanity'
import {ClipboardIcon} from '@sanity/icons'

export const skillEval = defineType({
  name: 'skillEval',
  title: 'Skill Eval',
  type: 'document',
  icon: ClipboardIcon,
  fields: [
    defineField({
      name: 'skill',
      title: 'Skill',
      type: 'reference',
      to: [{type: 'skill'}],
      validation: (rule) => rule.required(),
      description: 'Which skill does this test case belong to?',
    }),
    defineField({
      name: 'kind',
      title: 'What does this test?',
      type: 'string',
      initialValue: 'trigger',
      validation: (rule) => rule.required(),
      options: {
        list: [
          {title: 'Which skill fires (trigger)', value: 'trigger'},
          {title: 'How the skill behaves once loaded', value: 'behavior'},
        ],
        layout: 'radio',
      },
      description:
        'Trigger cases check that the right skill is picked from the description alone — they need no connectors and run on every publish. Behaviour cases check the answer once the skill is already loaded.',
    }),
    defineField({
      name: 'prompt',
      title: 'Test Prompt',
      type: 'text',
      rows: 4,
      validation: (rule) => rule.required(),
      description: 'The message to send. Write it as if you were asking an AI agent for help.',
    }),

    // ---- Trigger cases ----------------------------------------------------
    defineField({
      name: 'expectedSkill',
      title: 'Skill that should fire',
      type: 'reference',
      to: [{type: 'skill'}],
      hidden: ({document}) => document?.kind === 'behavior',
      description:
        'Which skill this prompt should reach. Often this skill — but the useful cases are the near-misses that should reach a sibling instead.',
      validation: (rule) =>
        rule.custom((value, context) => {
          const doc = context.document as {kind?: string; expectNone?: boolean} | undefined
          if (doc?.kind === 'behavior') return true
          if (value && doc?.expectNone) {
            return 'Choose one: a skill that should fire, or "no skill should fire".'
          }
          if (!value && !doc?.expectNone) {
            return 'Name the skill that should fire, or tick "no skill should fire".'
          }
          return true
        }),
    }),
    defineField({
      name: 'expectNone',
      title: 'No skill should fire',
      type: 'boolean',
      hidden: ({document}) => document?.kind === 'behavior',
      description:
        'The right answer is for the agent to answer directly without loading any skill. A library that fires a skill at everything is as broken as one that fires the wrong skill.',
    }),
    defineField({
      name: 'acceptableSkills',
      title: 'Also acceptable',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'skill'}]}],
      hidden: ({document}) => document?.kind === 'behavior',
      description:
        'Other skills that count as a correct answer — e.g. while two near-duplicate skills are both still published.',
    }),
    defineField({
      name: 'needsExpectation',
      title: 'Expectation still to be filled in',
      type: 'boolean',
      hidden: ({document}) => document?.kind === 'behavior',
      description:
        'Set on import from eval-queries.json, which records only that a prompt should not fire this skill — never which sibling it should reach. Name that skill above, then clear this.',
    }),

    // ---- Behaviour cases --------------------------------------------------
    defineField({
      name: 'expectedOutput',
      title: 'What Good Looks Like',
      type: 'text',
      rows: 3,
      hidden: ({document}) => document?.kind !== 'behavior',
      description: 'Describe in plain language what a good response should include.',
    }),
    defineField({
      name: 'expectations',
      title: 'Expectations',
      type: 'array',
      of: [{type: 'string'}],
      hidden: ({document}) => document?.kind !== 'behavior',
      description: 'What should the response include? Each is checked individually.',
      validation: (rule) =>
        rule.custom((value: string[] | undefined, context) => {
          const doc = context.document as {kind?: string} | undefined
          if (doc?.kind !== 'behavior') return true
          return value?.length ? true : 'Behaviour cases need at least one expectation to grade.'
        }),
    }),

    // ---- Both -------------------------------------------------------------
    defineField({
      name: 'inputContext',
      title: 'Additional Context',
      type: 'text',
      rows: 3,
      description: 'Optional extra context alongside the prompt (a document to review, background).',
    }),
    defineField({
      name: 'requiresConnectors',
      title: 'Connectors this case needs',
      type: 'array',
      of: [{type: 'string'}],
      options: {layout: 'tags'},
      description:
        'MCP server names this case has to reach to run (e.g. bigquery, gong). Leave empty and the case runs automatically on every publish; anything listed here has to be run against the real connectors and its result posted back.',
    }),
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [{type: 'string'}],
      options: {layout: 'tags'},
      description: 'Tags for organizing test cases (e.g. "near-miss", "edge-case", "regression").',
    }),
  ],
  preview: {
    select: {
      title: 'prompt',
      kind: 'kind',
      skillName: 'skill.skillName',
      expectedName: 'expectedSkill.skillName',
      expectNone: 'expectNone',
      needsExpectation: 'needsExpectation',
    },
    prepare({title, kind, skillName, expectedName, expectNone, needsExpectation}) {
      const expectation =
        kind === 'behavior'
          ? 'behaviour'
          : needsExpectation
            ? 'expects: ?'
            : expectNone
              ? 'expects: no skill'
              : expectedName
                ? `expects: ${expectedName}`
                : undefined

      return {
        title: title ? (title.length > 60 ? title.slice(0, 60) + '…' : title) : 'Untitled eval',
        subtitle: [skillName && `on ${skillName}`, expectation].filter(Boolean).join(' · '),
        media: ClipboardIcon,
      }
    },
  },
})
