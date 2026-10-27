import {defineType, defineField} from 'sanity'
import {UsersIcon} from '@sanity/icons'
import {skillsConfig} from '../skills.config'

/**
 * A consumer group of skills. Each audience maps 1:1 to a plugin folder in
 * this repo's marketplace — publishing a skill writes it into every plugin
 * matching its audiences. The "Everyone" audience overrides its folder to
 * `everyonePluginName` from skills.config.ts.
 */
export const audience = defineType({
  name: 'audience',
  title: 'Audience',
  type: 'document',
  icon: UsersIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      description: 'Display name, e.g. "Engineering" or "Everyone".',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'title'},
      description:
        'Becomes the plugin folder and plugin name in the marketplace, unless overridden below.',
      validation: (rule) =>
        rule.required().custom((slug) => {
          if (!slug?.current) return true
          return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.current)
            ? true
            : 'Must be lowercase with hyphens only (e.g. "core-management")'
        }),
    }),
    defineField({
      name: 'pluginTitle',
      title: 'Plugin Display Name',
      type: 'string',
      description:
        'Human-friendly name shown in plugin browsers and org settings (e.g. "Org-wide skills"). Falls back to the audience title. Does not affect the install name.',
    }),
    defineField({
      name: 'pluginDescription',
      title: 'Plugin Description',
      type: 'text',
      rows: 3,
      description:
        'Shown in the plugin marketplace listing. Say who this plugin is for and what its skills cover.',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'overviewNotes',
      title: 'Overview Skill Notes',
      type: 'markdown',
      description:
        'Optional markdown appended to this plugin\'s generated "<plugin>-overview" skill — team conventions, how to choose between skills, escalation paths. Shows up after the skill list. Note: changes here reach GitHub on the next skill publish (or a resync), not immediately.',
    }),
    defineField({
      name: 'autoInstall',
      title: 'Auto-install for the whole org',
      type: 'boolean',
      initialValue: false,
      description:
        'When true, this plugin should be set to "Installed by default" in the Claude org settings. Reserved for the Everyone audience.',
    }),
    defineField({
      name: 'pluginName',
      title: 'Plugin Name Override',
      type: 'string',
      description:
        `Overrides the slug as plugin folder and marketplace name. Set Everyone to "${skillsConfig.everyonePluginName}" (from skills.config.ts).`,
      validation: (rule) =>
        rule
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {name: 'slug'})
          .error('Must be lowercase with hyphens only'),
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'pluginDescription', autoInstall: 'autoInstall'},
    prepare({title, subtitle, autoInstall}) {
      return {
        title: autoInstall ? `${title} (auto-installed)` : title,
        subtitle,
        media: UsersIcon,
      }
    },
  },
})
