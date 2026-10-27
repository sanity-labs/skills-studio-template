import {defineType, defineField, defineArrayMember} from 'sanity'
import {ActivityIcon} from '@sanity/icons'

export const skillEvalRun = defineType({
  name: 'skillEvalRun',
  title: 'Eval Run',
  type: 'document',
  icon: ActivityIcon,
  readOnly: true,
  fields: [
    defineField({
      name: 'skill',
      title: 'Skill',
      type: 'reference',
      to: [{type: 'skill'}],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'skillVersion',
      title: 'Skill Version',
      type: 'string',
      description: 'The _rev of the skill at the time of this run.',
    }),
    defineField({
      name: 'runType',
      title: 'Run Type',
      type: 'string',
      options: {
        list: [
          {title: 'Single Test', value: 'single'},
          {title: 'Benchmark', value: 'benchmark'},
          {title: 'Comparison', value: 'comparison'},
        ],
      },
    }),
    defineField({
      name: 'trigger',
      title: 'Trigger',
      type: 'string',
      options: {
        list: [
          {title: 'Manual', value: 'manual'},
          {title: 'On Publish', value: 'on-publish'},
          {title: 'Scheduled', value: 'scheduled'},
        ],
      },
    }),
    defineField({
      name: 'model',
      title: 'Model',
      type: 'string',
      description:
        'The model used for this eval run — Claude, GPT or Gemini (see utils/aiProviders.ts). Skills are harness- and model-agnostic, so a result is only meaningful alongside the model it was produced with.',
    }),
    defineField({
      name: 'results',
      title: 'Results',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({
              name: 'eval',
              title: 'Eval',
              type: 'reference',
              to: [{type: 'skillEval'}],
            }),
            defineField({
              name: 'prompt',
              title: 'Prompt',
              type: 'text',
              description: 'Denormalized for history.',
            }),
            defineField({
              name: 'response',
              title: 'Response',
              type: 'text',
            }),
            defineField({
              name: 'expectations',
              title: 'Expectation Results',
              type: 'array',
              of: [
                defineArrayMember({
                  type: 'object',
                  fields: [
                    defineField({name: 'text', type: 'string', title: 'Expectation'}),
                    defineField({name: 'passed', type: 'boolean', title: 'Passed'}),
                    defineField({name: 'evidence', type: 'text', title: 'Evidence'}),
                  ],
                }),
              ],
            }),
            defineField({name: 'passRate', type: 'number', title: 'Pass Rate'}),
            defineField({name: 'tokenUsage', type: 'number', title: 'Token Usage'}),
            defineField({name: 'durationMs', type: 'number', title: 'Duration (ms)'}),
          ],
          preview: {
            select: {
              prompt: 'prompt',
              passRate: 'passRate',
            },
            prepare({prompt, passRate}) {
              const rate = passRate != null ? `${Math.round(passRate * 100)}%` : '\u2014'
              return {
                title: prompt ? (prompt.length > 50 ? prompt.slice(0, 50) + '\u2026' : prompt) : 'Unknown',
                subtitle: `Pass rate: ${rate}`,
              }
            },
          },
        }),
      ],
    }),
    defineField({
      name: 'summary',
      title: 'Summary',
      type: 'object',
      fields: [
        defineField({name: 'totalEvals', type: 'number', title: 'Total Evals'}),
        defineField({name: 'passed', type: 'number', title: 'Passed'}),
        defineField({name: 'failed', type: 'number', title: 'Failed'}),
        defineField({name: 'passRate', type: 'number', title: 'Pass Rate'}),
        defineField({name: 'avgDurationMs', type: 'number', title: 'Avg Duration (ms)'}),
        defineField({name: 'avgTokens', type: 'number', title: 'Avg Tokens'}),
      ],
    }),
    defineField({
      name: 'suggestions',
      title: 'Improvement Suggestions',
      type: 'text',
      description: 'AI-generated suggestions for improving the skill based on failed expectations.',
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'array',
      of: [{type: 'string'}],
    }),
    defineField({
      name: 'improvementSuggestions',
      title: 'Improvement Suggestions',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({
              name: 'priority',
              type: 'string',
              title: 'Priority',
              options: {list: ['high', 'medium', 'low']},
            }),
            defineField({
              name: 'category',
              type: 'string',
              title: 'Category',
              options: {
                list: ['description', 'instructions', 'examples', 'references', 'structure'],
              },
            }),
            defineField({name: 'suggestion', type: 'text', title: 'Suggestion'}),
            defineField({name: 'expectedImpact', type: 'text', title: 'Expected Impact'}),
          ],
          preview: {
            select: {title: 'suggestion', subtitle: 'priority'},
          },
        }),
      ],
    }),
  ],
  preview: {
    select: {
      skillName: 'skill.skillName',
      runType: 'runType',
      passRate: 'summary.passRate',
      createdAt: '_createdAt',
    },
    prepare({skillName, runType, passRate, createdAt}) {
      const rate = passRate != null ? `${Math.round(passRate * 100)}%` : '\u2014'
      const date = createdAt ? new Date(createdAt).toLocaleDateString() : ''
      return {
        title: `${skillName || 'Unknown'} \u2014 ${rate}`,
        subtitle: `${runType || 'unknown'} \u00b7 ${date}`,
        media: ActivityIcon,
      }
    },
  },
})
