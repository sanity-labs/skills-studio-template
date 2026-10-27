import {defineType, defineField, defineArrayMember} from 'sanity'
import {SplitVerticalIcon} from '@sanity/icons'
import {MODELS} from '../utils/aiProviders'

// Build the list of model options for the condition.modelId enum. The
// label is what the author sees; the value is the stable model id used
// downstream by aggregate.ts + the generate-pairs action.
const MODEL_OPTIONS = MODELS.map((m) => ({title: m.label, value: m.id}))

export const proseTestSession = defineType({
  name: 'proseTestSession',
  title: 'Prose test session',
  type: 'document',
  icon: SplitVerticalIcon,
  fields: [
    defineField({name: 'title', type: 'string', validation: (Rule) => Rule.required()}),
    defineField({name: 'description', type: 'text', rows: 3}),
    defineField({
      name: 'status',
      type: 'string',
      options: {list: ['open', 'closed'], layout: 'radio'},
      initialValue: 'open',
    }),
    defineField({name: 'createdAt', type: 'datetime', readOnly: true}),
    defineField({name: 'createdBy', type: 'string', readOnly: true}),
    defineField({
      name: 'conditions',
      title: 'Conditions',
      description:
        'Each condition is a (model + skills) setup whose prose you want to compare. Pairs reference these by conditionId.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'condition',
          fields: [
            defineField({
              name: 'conditionId',
              type: 'string',
              description:
                'Short identifier used in pairs[].A.conditionId / pairs[].B.conditionId. Lowercase, no spaces (e.g. "claude_v21", "gpt_baseline").',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'label',
              type: 'string',
              description: 'Display name shown after voting reveals.',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'modelId',
              type: 'string',
              title: 'Model',
              description:
                'Which model generated this condition\'s prose. Used by the aggregate to tally wins by model family and (eventually) by the generate-pairs action.',
              options: {list: MODEL_OPTIONS},
            }),
            defineField({
              name: 'skills',
              type: 'array',
              title: 'Skills',
              description:
                'The skill stack loaded for this condition. Use [] (or leave empty) for a raw-model baseline.',
              of: [defineArrayMember({type: 'reference', to: [{type: 'skill'}]})],
            }),
            defineField({
              name: 'notes',
              type: 'text',
              rows: 2,
              description:
                'Anything else that distinguishes this condition: temperature, system prompt overrides, prompt-engineering notes, etc.',
            }),
          ],
          preview: {
            select: {title: 'label', subtitle: 'conditionId', modelId: 'modelId'},
            prepare({title, subtitle, modelId}) {
              return {
                title: title || 'Untitled condition',
                subtitle: modelId ? `${subtitle} · ${modelId}` : subtitle,
              }
            },
          },
        }),
      ],
    }),
    defineField({
      name: 'prompts',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'prompt',
          fields: [
            defineField({name: 'id', type: 'string', validation: (Rule) => Rule.required()}),
            defineField({name: 'name', type: 'string', validation: (Rule) => Rule.required()}),
            defineField({name: 'text', type: 'text', rows: 4, validation: (Rule) => Rule.required()}),
          ],
          preview: {select: {title: 'name', subtitle: 'id'}},
        }),
      ],
    }),
    defineField({
      name: 'pairs',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'pair',
          fields: [
            defineField({name: 'promptId', type: 'string', validation: (Rule) => Rule.required()}),
            defineField({
              name: 'A',
              type: 'object',
              fields: [
                defineField({name: 'conditionId', type: 'string', validation: (Rule) => Rule.required()}),
                defineField({name: 'text', type: 'text', rows: 10, validation: (Rule) => Rule.required()}),
              ],
            }),
            defineField({
              name: 'B',
              type: 'object',
              fields: [
                defineField({name: 'conditionId', type: 'string', validation: (Rule) => Rule.required()}),
                defineField({name: 'text', type: 'text', rows: 10, validation: (Rule) => Rule.required()}),
              ],
            }),
            defineField({
              name: 'aIsClaude',
              type: 'boolean',
              description:
                'Deprecated. Used by old sessions for two-way claude-vs-gpt tally; new sessions should rely on condition.modelId instead. Hidden from voter UI.',
              hidden: true,
            }),
          ],
          preview: {select: {title: 'promptId'}},
        }),
      ],
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'status'},
    prepare({title, subtitle}) {
      return {
        title: title || 'Untitled session',
        subtitle: subtitle === 'closed' ? '🔒 closed' : '🟢 open',
      }
    },
  },
})
