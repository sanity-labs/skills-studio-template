import {defineType, defineField} from 'sanity'
import {UserIcon} from '@sanity/icons'

/**
 * A person in the org directory, used by the skill owner picker. Add people
 * by hand in the Studio, or bulk-load them from a CSV with
 * `scripts/import-people.ts`. If you already keep a directory elsewhere
 * (HRIS, another Sanity project), a scheduled Function can keep these in
 * sync — see automation/README.md.
 */
export const orgPerson = defineType({
  name: 'orgPerson',
  title: 'Person',
  type: 'document',
  icon: UserIcon,
  fields: [
    defineField({name: 'name', title: 'Name', type: 'string', validation: (r) => r.required()}),
    defineField({
      name: 'email',
      title: 'Email',
      type: 'string',
      validation: (r) => r.required().email(),
    }),
    defineField({
      name: 'slackId',
      title: 'Slack ID',
      type: 'string',
      description: 'Optional. Member ID (e.g. U012AB3CD) so the freshness digest can @-mention this person.',
    }),
    defineField({name: 'jobTitle', title: 'Job Title', type: 'string'}),
    defineField({name: 'avatarUrl', title: 'Avatar URL', type: 'url'}),
  ],
  preview: {
    select: {title: 'name', subtitle: 'jobTitle', email: 'email'},
    prepare({title, subtitle, email}) {
      return {title, subtitle: subtitle || email}
    },
  },
})
