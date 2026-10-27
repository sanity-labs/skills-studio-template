import {defineType, defineField, defineArrayMember} from 'sanity'
import {DashboardIcon} from '@sanity/icons'

/**
 * Latest checks on one skill on its own: does the description do its job, and do
 * its trigger rows reach it when routed over the whole library.
 *
 * One document per skill (`skillQuality.<skillId>`), overwritten on each check;
 * `skillEvalRun` keeps the history. Pairwise findings live on `skillRelation`.
 * Like those, every number is a model's probability, and `descriptionHash`
 * tells a current result from a stale one.
 */
export const skillQuality = defineType({
  name: 'skillQuality',
  title: 'Skill comparison results',
  type: 'document',
  icon: DashboardIcon,
  readOnly: true,
  fields: [
    defineField({name: 'skill', title: 'Skill', type: 'reference', to: [{type: 'skill'}], weak: true}),
    defineField({
      name: 'summary',
      title: 'Summary',
      type: 'text',
      rows: 3,
      description: 'Plain-language summary of the results below.',
    }),
    defineField({
      name: 'bodyHash',
      title: 'Content fingerprint',
      type: 'string',
      description: 'A fingerprint of the skill’s content (instructions) when it was last compared. If it no longer matches, the results are out of date.',
    }),
    defineField({
      name: 'lint',
      title: 'Description check',
      type: 'object',
      description: 'Whether the description does what a good skill description does, judged on the description alone.',
      fields: [
        defineField({
          name: 'checks',
          title: 'Checks',
          type: 'array',
          description: 'One per description rule: what a good skill description does.',
          of: [
            defineArrayMember({
              type: 'object',
              name: 'descriptionCheck',
              fields: [
                defineField({name: 'rule', title: 'Rule', type: 'string', description: 'Rule id, e.g. says_not_for.'}),
                defineField({name: 'title', title: 'Title', type: 'string'}),
                defineField({name: 'probability', title: 'Answer', type: 'number', description: 'How likely the answer to the rule’s question is yes, from 0 to 1.'}),
                defineField({name: 'passed', title: 'Passed', type: 'boolean'}),
              ],
              preview: {select: {title: 'title', passed: 'passed'}, prepare: ({title, passed}) => ({title, subtitle: passed ? 'passed' : 'needs work'})},
            }),
          ],
        }),
        defineField({name: 'descriptionHash', title: 'Description fingerprint', type: 'string', description: 'A fingerprint of the description that was checked. If it no longer matches the skill, these results are out of date.'}),
        defineField({name: 'model', title: 'Model', type: 'string'}),
        defineField({name: 'checkedAt', title: 'Checked at', type: 'datetime'}),
      ],
    }),
    defineField({
      name: 'routing',
      title: 'Test requests',
      type: 'object',
      description:
        'This skill’s test requests, with the AI choosing from every skill’s description. A miss shows the skill it picked instead.',
      fields: [
        defineField({name: 'total', title: 'Test requests', type: 'number'}),
        defineField({name: 'correct', title: 'Picked correctly', type: 'number'}),
        defineField({
          name: 'misses',
          title: 'Picked wrongly',
          type: 'array',
          of: [
            defineArrayMember({
              type: 'object',
              name: 'routingMiss',
              fields: [
                defineField({name: 'prompt', title: 'Prompt', type: 'text', rows: 2}),
                defineField({name: 'expected', title: 'Should have gone to', type: 'string', description: 'Skill name, or none.'}),
                defineField({name: 'chose', title: 'Went to', type: 'string', description: 'Skill the AI picked, or none.'}),
                defineField({name: 'confidence', title: 'Confidence', type: 'number'}),
              ],
              preview: {select: {title: 'prompt', expected: 'expected', chose: 'chose'}, prepare: ({title, expected, chose}) => ({title, subtitle: `should have gone to ${expected}, went to ${chose}`})},
            }),
          ],
        }),
        defineField({name: 'losesTo', title: 'Went to instead', type: 'array', of: [{type: 'string'}], description: 'Skills the AI picked instead, most often first.'}),
        defineField({name: 'descriptionHash', title: 'Description hash', type: 'string'}),
        defineField({name: 'model', title: 'Model', type: 'string'}),
        defineField({name: 'checkedAt', title: 'Checked at', type: 'datetime'}),
      ],
    }),
    defineField({
      name: 'overrides',
      title: 'Published anyway',
      type: 'array',
      description:
        'Each time someone published while publishing was paused, with their reason. It only covers the description it was given for: changing the description asks again.',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'gateOverride',
          fields: [
            defineField({name: 'reason', title: 'Reason', type: 'text', rows: 2}),
            defineField({name: 'descriptionHash', title: 'Description hash', type: 'string'}),
            defineField({name: 'findings', title: 'What paused publishing', type: 'array', of: [{type: 'string'}]}),
            defineField({name: 'by', title: 'By', type: 'string'}),
            defineField({name: 'at', title: 'At', type: 'datetime'}),
          ],
          preview: {select: {title: 'reason', subtitle: 'by'}},
        }),
      ],
    }),
  ],
  preview: {
    select: {name: 'skill.skillName', total: 'routing.total', correct: 'routing.correct'},
    prepare: ({name, total, correct}) => ({title: name ?? 'Unknown skill', subtitle: total ? `${correct} of ${total} test requests picked correctly` : 'no test requests yet'}),
  },
})
