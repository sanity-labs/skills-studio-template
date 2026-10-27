import {defineType, defineField} from 'sanity'
import {DocumentTextIcon} from '@sanity/icons'
import {SimilarSkillsField} from '../components/SimilarSkillsField'
import {countTokens} from '../utils/tokenCount'

export const skillReference = defineType({
  name: 'skillReference',
  title: 'Skill Reference',
  type: 'document',
  icon: DocumentTextIcon,
  fields: [
    // UI-only field: warns about semantically similar existing references.
    defineField({
      name: 'similarReferencesCheck',
      type: 'string',
      components: {
        field: SimilarSkillsField,
      },
    }),
    defineField({
      name: 'filename',
      title: 'Filename',
      type: 'string',
      description: 'File name for this reference (e.g. "groq"). The .md extension is added automatically. Include an extension only for non-Markdown files (e.g. "component.tsx").',
      validation: (rule) =>
        rule
          .required()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z]+)?$/, {
            name: 'filename',
            invert: false,
          })
          .error(
            'Lowercase letters and hyphens only (e.g. "brand-voice"). Add an extension only for non-Markdown files (e.g. "component.tsx").'
          ),
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      description: 'Display name shown in Studio. Not included in the exported file.',
    }),
    defineField({
      name: 'content',
      title: 'Content',
      type: 'markdown',
      description: 'The content of this reference file. Keep it focused on one topic — agents load references on demand when they need more detail.',
      validation: (rule) => [
        rule.required(),
        rule.custom((value: string | undefined) => {
          if (!value) return true
          const tokens = countTokens(value)
          if (tokens > 30000) {
            return {
              message: `This reference is ~${Math.round(tokens / 1000)}k tokens — that's large for an agent's context window. Consider splitting into smaller, focused files.`,
              level: 'warning',
            } as any
          }
          return true
        }),
      ],
    }),
  ],
  preview: {
    select: {
      title: 'title',
      filename: 'filename',
    },
    prepare({title, filename}) {
      return {
        title: title || filename || 'Untitled Reference',
        subtitle: filename ? `references/${filename}` : undefined,
        media: DocumentTextIcon,
      }
    },
  },
})
