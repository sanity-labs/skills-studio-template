import {defineType, defineField, defineArrayMember} from 'sanity'
import {CheckmarkCircleIcon} from '@sanity/icons'

export const proseVote = defineType({
  name: 'proseVote',
  title: 'Prose vote',
  type: 'document',
  icon: CheckmarkCircleIcon,
  fields: [
    defineField({
      name: 'sessionId',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'voter',
      type: 'string',
      description: 'Voter identity (Sanity user display name)',
      validation: (Rule) => Rule.required(),
      readOnly: true,
    }),
    defineField({
      name: 'voterId',
      type: 'string',
      description: 'Sanity user _id, for dedup',
      readOnly: true,
    }),
    defineField({
      name: 'submittedAt',
      type: 'datetime',
      readOnly: true,
    }),
    defineField({
      name: 'picks',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'promptId', type: 'string', validation: (Rule) => Rule.required()}),
            defineField({
              name: 'pick',
              type: 'string',
              options: {list: ['A', 'B', 'EQ']},
              validation: (Rule) => Rule.required(),
            }),
            defineField({name: 'note', type: 'text', rows: 2}),
          ],
          preview: {select: {title: 'promptId', subtitle: 'pick'}},
        }),
      ],
    }),
  ],
  preview: {
    select: {title: 'voter', subtitle: 'sessionId'},
    prepare({title, subtitle}) {
      return {title: title || 'Anonymous voter', subtitle}
    },
  },
})
