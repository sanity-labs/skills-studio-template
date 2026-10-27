import {defineType, defineField} from 'sanity'

export const skillStats = defineType({
  name: 'skillStats',
  title: 'Skill Stats',
  type: 'document',
  fields: [
    defineField({
      name: 'skillId',
      type: 'string',
      title: 'Skill ID',
      description: 'The _id of the skill this tracks',
    }),
    defineField({
      name: 'downloads',
      type: 'number',
      title: 'Downloads',
      initialValue: 0,
    }),
    defineField({
      name: 'likes',
      type: 'number',
      title: 'Likes',
      initialValue: 0,
    }),
  ],
})
