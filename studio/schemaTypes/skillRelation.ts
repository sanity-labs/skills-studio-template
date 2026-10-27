import {defineType, defineField} from 'sanity'
import {LinkIcon} from '@sanity/icons'
import {ACTIONS, RELATIONSHIPS} from '../utils/skillSignals'

/**
 * How two skills relate: whether they compete for the same requests, and
 * whether their bodies duplicate or contradict each other.
 *
 * One document per pair (`skillRelation.<idA>.<idB>`, ids sorted), written by
 * the overlap checks and never by hand — except `acknowledgement`, which is a
 * person's decision about the pair. Kept off the `skill` document on purpose:
 * writing results there would create revisions and trigger the GitHub sync.
 *
 * Every number is a probability or score from a decision model, not a
 * verdict. Each block records the model and the hashes of the text it judged,
 * so a result for text that has since changed can be recognised as stale.
 */
const hashFields = [
  defineField({
    name: 'hashA',
    title: 'Fingerprint of skill A',
    type: 'string',
    description: 'A fingerprint of the text that was compared. If it no longer matches the skill, this result is out of date.',
  }),
  defineField({
    name: 'hashB',
    title: 'Fingerprint of skill B',
    type: 'string',
    description: 'A fingerprint of the text that was compared. If it no longer matches the skill, this result is out of date.',
  }),
  defineField({name: 'model', title: 'Model', type: 'string', description: 'The AI model that made the comparison, e.g. typesafe/jev-1.13.'}),
  defineField({name: 'checkedAt', title: 'Checked at', type: 'datetime'}),
]

export const skillRelation = defineType({
  name: 'skillRelation',
  title: 'Similar skill pair',
  type: 'document',
  icon: LinkIcon,
  fields: [
    defineField({
      name: 'skillA',
      title: 'Skill A',
      type: 'reference',
      to: [{type: 'skill'}],
      weak: true,
      readOnly: true,
      description: 'One of the two skills. Which one is A has no meaning.',
    }),
    defineField({
      name: 'skillB',
      title: 'Skill B',
      type: 'reference',
      to: [{type: 'skill'}],
      weak: true,
      readOnly: true,
    }),
    defineField({
      name: 'summary',
      title: 'Summary',
      type: 'text',
      rows: 3,
      readOnly: true,
      description: 'Plain-language summary of the comparison.',
    }),
    defineField({
      name: 'description',
      title: 'Compared on descriptions',
      type: 'object',
      readOnly: true,
      description: 'Based only on the two names and descriptions: what an AI sees when it chooses a skill.',
      fields: [
        defineField({
          name: 'relationship',
          title: 'Relationship',
          type: 'string',
          options: {list: [...RELATIONSHIPS]},
          description:
            'duplicate: the same job · overlapping_triggers: different jobs that cover some of the same requests · supersedes: one covers everything the other does · complementary: related, different jobs · unrelated.',
        }),
        defineField({name: 'relationshipConfidence', title: 'Relationship confidence', type: 'number', description: 'How sure the comparison is about the relationship above, from 0 to 1.'}),
        defineField({
          name: 'competing',
          title: 'Competing',
          type: 'number',
          description: 'How likely the two skills compete for the same requests, from 0 to 1 (duplicate + overlapping_triggers + supersedes). 0.2 or higher is worth a look.',
        }),
        defineField({
          name: 'sameTrigger',
          title: 'Same trigger',
          type: 'number',
          description: 'How likely a request meant for one skill would go to the other, from 0 to 1. 0.5 or higher means the AI could pick either.',
        }),
        defineField({
          name: 'overlap',
          title: 'Overlap',
          type: 'number',
          description: '0 no overlap · 1 same area, different jobs · 2 some of the same requests · 3 nearly the same skill. Can be a fraction.',
        }),
        ...hashFields,
      ],
    }),
    defineField({
      name: 'body',
      title: 'Compared on instructions',
      type: 'object',
      readOnly: true,
      description: 'Based on the full instructions of both skills. Only run for skills that are close to each other.',
      fields: [
        defineField({
          name: 'contradicts',
          title: 'Contradicts',
          type: 'number',
          description: 'How likely the instructions disagree (different definitions, rules or steps for the same thing), from 0 to 1. Sometimes on purpose, so check before changing anything.',
        }),
        defineField({
          name: 'duplicatedProcedure',
          title: 'Duplicated procedure',
          type: 'number',
          description: 'How likely the two skills repeat a large block of the same instructions, from 0 to 1.',
        }),
        defineField({
          name: 'recommendedAction',
          title: 'Recommended action',
          type: 'string',
          options: {list: [...ACTIONS]},
          description: 'merge: combine into one skill · extract_shared: move shared instructions into one reference · clarify_boundary: make each description say what it’s for · keep: no change needed.',
        }),
        defineField({name: 'actionConfidence', title: 'Action confidence', type: 'number', description: 'How sure the comparison is about the suggestion, from 0 to 1.'}),
        ...hashFields,
      ],
    }),
    defineField({
      name: 'routing',
      title: 'Mixed up in test requests',
      type: 'object',
      readOnly: true,
      description: 'How often the AI picked one of these skills for a test request that belonged to the other.',
      fields: [
        defineField({name: 'confusedRows', title: 'Test requests mixed up', type: 'number', description: 'Test requests where the AI leaned 0.1 or more towards the wrong skill of the two.'}),
        defineField({name: 'mass', title: 'Pull towards the wrong skill', type: 'number', description: 'Total probability the AI gave the wrong skill across those test requests.'}),
        defineField({name: 'examples', title: 'Example test requests', type: 'array', of: [{type: 'string'}]}),
        defineField({name: 'model', title: 'Model', type: 'string'}),
        defineField({name: 'checkedAt', title: 'Checked at', type: 'datetime'}),
      ],
    }),
    defineField({
      name: 'acknowledgement',
      title: 'Marked as intended',
      type: 'object',
      description:
        'Fill this in when the overlap is on purpose, e.g. “Docs and marketing follow different style guides.” A pair marked as intended no longer pauses publishing.',
      fields: [
        defineField({name: 'reason', title: 'Reason', type: 'text', rows: 2, validation: (rule) => rule.required()}),
        defineField({name: 'by', title: 'By', type: 'string'}),
        defineField({name: 'at', title: 'At', type: 'datetime'}),
      ],
    }),
  ],
  preview: {
    select: {a: 'skillA.skillName', b: 'skillB.skillName', relationship: 'description.relationship', ack: 'acknowledgement.reason'},
    prepare({a, b, relationship, ack}) {
      return {
        title: `${a ?? '?'} ↔ ${b ?? '?'}`,
        subtitle: [relationship?.replaceAll('_', ' '), ack ? 'marked as intended' : null].filter(Boolean).join(' · '),
      }
    },
  },
})
