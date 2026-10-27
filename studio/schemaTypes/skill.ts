import {defineType, defineField, defineArrayMember} from 'sanity'
import {BookIcon} from '@sanity/icons'
import {GitHubSyncBannerField} from '../components/GitHubSyncBannerField'
import {OwnersInput} from '../components/OwnersInput'
import {SimilarSkillsField} from '../components/SimilarSkillsField'
import {EvalStatusField} from '../components/EvalStatusField'
import {ComparisonPanelField} from '../components/ComparisonPanelField'
import {countTokens} from '../utils/tokenCount'
import {ORG_NAME} from '../utils/constants'
import {comparisonMarkers, type ValidatedSkill} from '../utils/comparisonValidation'

export const skill = defineType({
  name: 'skill',
  title: 'Skill',
  type: 'document',
  icon: BookIcon,
  description: 'When you publish a skill, it automatically syncs to the GitHub repo.',
  // The last comparison with other skills, relayed from metadata.comparison to
  // the field each finding is about. An error disables Publish in the Studio.
  validation: (rule) => [
    rule.custom((doc) => comparisonMarkers(doc as ValidatedSkill | undefined, 'hold')).error(),
    rule.custom((doc) => comparisonMarkers(doc as ValidatedSkill | undefined, 'warn')).warning(),
    rule.custom((doc) => comparisonMarkers(doc as ValidatedSkill | undefined, 'tip')).info(),
  ],
  groups: [
    {name: 'content', title: 'Content', default: true},
    {name: 'metadata', title: 'Metadata'},
  ],
  fieldsets: [
    {
      name: 'githubSync',
      title: 'GitHub Sync',
      options: {collapsible: true, collapsed: true},
    },
  ],
  fields: [
    // UI-only field: renders the sync banner component. Does not store data.
    defineField({
      name: 'githubSyncStatus',
      type: 'string',
      group: 'content',
      components: {
        field: GitHubSyncBannerField,
      },
    }),
    // UI-only field: warns about semantically similar existing skills.
    defineField({
      name: 'similarSkillsCheck',
      type: 'string',
      group: 'content',
      components: {
        field: SimilarSkillsField,
      },
    }),
    // UI-only field: the last comparison with other skills, with a button to run it.
    defineField({
      name: 'comparisonPanel',
      type: 'string',
      group: 'content',
      components: {
        field: ComparisonPanelField,
      },
    }),
    // UI-only field: eval coverage for this skill, and the last run.
    defineField({
      name: 'evalStatus',
      type: 'string',
      group: 'content',
      components: {
        field: EvalStatusField,
      },
    }),
    defineField({
      name: 'skillName',
      title: 'Skill Name',
      type: 'string',
      group: 'content',
      description: 'The unique identifier for this skill. Lowercase letters and hyphens only (e.g. "authentic-content"). This becomes the folder name on GitHub. Locked after first sync.',
      readOnly: ({document}) => !!document?.lastPublishedCommit,
      validation: (rule) => [
        rule
          .required()
          .max(64)
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
            name: 'slug',
            invert: false,
          })
          .error('Must be lowercase with hyphens only (e.g. "authentic-content")'),
        rule
          .custom((value: string | undefined) =>
            value?.endsWith('-overview')
              ? 'Names ending in "-overview" are reserved for the generated plugin directory skills'
              : true,
          )
          .error(),
      ],
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      group: 'content',
      description: 'Display name for this skill. Shown in Studio and Downloads. If empty, the skill name is used.',
    }),
    defineField({
      name: 'description',
      title: 'Description: when to use this skill',
      type: 'text',
      rows: 5,
      group: 'content',
      description: 'AI assistants read only this to decide whether to use the skill. Say what it helps with, when to use it (what people ask), and what it’s not for. Leave out how it works; that belongs in Content. Under 1024 characters.',
      validation: (rule) => [
        rule.required(),
        rule.max(1024).warning('Keep under 1024 characters so agents can match on it effectively.'),
      ],
    }),
    defineField({
      name: 'content',
      title: 'Content',
      type: 'markdown',
      group: 'content',
      description: 'The main instructions for this skill. Click the \uD83D\uDC41 (eye) icon in the toolbar to preview formatted markdown. Move detailed reference material to separate reference files.',
      validation: (rule) => [
        rule.required(),
        rule.custom((value: string | undefined) => {
          if (!value) return true
          if (value.trimStart().startsWith('---')) {
            return {
              message: 'Looks like this contains frontmatter (---). The name, description, version, and metadata are managed in separate fields and added automatically when published. Remove the frontmatter block and use the Metadata tab for tags, visibility, and owner.',
              level: 'warning',
            } as any
          }
          return true
        }),
        rule.custom((value: string | undefined) => {
          if (!value) return true
          const tokens = countTokens(value)
          if (tokens > 5000) {
            return {
              message: `Content is ~${Math.round(tokens / 1000)}k tokens (recommended: under 5k). Move detailed sections to reference files \u2014 agents load those on demand without using context space.`,
              level: 'warning',
            } as any
          }
          return true
        }),
      ],
    }),
    defineField({
      name: 'references',
      title: 'Reference Files',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({type: 'reference', to: [{type: 'skillReference'}]})],
      description: 'Reference files for this skill. Agents load these on demand when they need more detail. Order matters \u2014 agents see the list in this order.',
      validation: (rule) =>
        rule.custom(async (refs: any[] | undefined, context) => {
          if (!refs || refs.length === 0) return true
          const client = context.getClient({apiVersion: '2024-01-01'})
          const refIds = refs.map((r: any) => r._ref).filter(Boolean)
          if (refIds.length === 0) return true
          const refDocs = await client.fetch(
            `*[_id in $ids]{ _id, filename, content }`,
            {ids: refIds}
          )
          const largeRefs = refDocs
            .filter((doc: any) => countTokens(doc.content || '') > 30000)
            .map((doc: any) => `${doc.filename} (~${Math.round(countTokens(doc.content || '') / 1000)}k tokens)`)
          if (largeRefs.length > 0) {
            return {
              message: `Large references: ${largeRefs.join(', ')}. These may exceed agent context limits.`,
              level: 'warning',
            } as any
          }
          return true
        }),
    }),
    defineField({
      name: 'audiences',
      title: 'Audiences',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({type: 'reference', to: [{type: 'audience'}]})],
      description:
        'Who this skill is for. The skill is published into each audience\'s plugin on GitHub. Use "Everyone" only for genuinely org-wide skills. Changing this moves the skill between plugins on the next sync. A skill with no audience is never synced \u2014 there is no plugin folder to write it into.',
      validation: (rule) => [
        rule
          .required()
          .min(1)
          .unique()
          .error('Pick at least one audience \u2014 skills without an audience are never synced to GitHub'),
        // min(1) counts array members, not resolvable references: a row left as
        // an empty reference picker still passes it, and the sync then
        // dereferences nothing and skips the skill anyway. Require a real _ref.
        rule
          .custom((refs: any[] | undefined) =>
            refs?.length && refs.some((ref) => !ref?._ref)
              ? 'Every audience row must point at an audience \u2014 remove the empty row, or the sync will skip this skill'
              : true,
          )
          .error(),
      ],
    }),
    // Maps to Claude Code's invocation frontmatter in utils/assemble.ts. Top
    // level (not under metadata) so a change here triggers the GitHub sync.
    defineField({
      name: 'invocation',
      title: 'Invocation',
      type: 'object',
      group: 'content',
      description: 'Claude Code settings. Other tools may ignore them.',
      options: {collapsible: true, collapsed: true},
      fields: [
        defineField({
          name: 'mode',
          title: 'Who can invoke this skill?',
          type: 'string',
          description:
            'Only people: Claude never loads it on its own. Use for workflows with side effects. Only Claude: background knowledge that makes no sense as a command.',
          options: {
            list: [
              {title: 'Claude and people (default)', value: 'default'},
              {title: 'Only people, by typing /skill-name', value: 'userOnly'},
              {title: 'Only Claude (hidden from the / menu)', value: 'modelOnly'},
            ],
            layout: 'radio',
          },
          initialValue: 'default',
        }),
        defineField({
          name: 'argumentHint',
          title: 'Argument hint',
          type: 'string',
          description: 'Shown after /skill-name while typing, e.g. [ticket-url]. Optional.',
          hidden: ({parent}) => parent?.mode === 'modelOnly',
        }),
      ],
    }),
    defineField({
      name: 'metadata',
      title: 'Metadata',
      type: 'object',
      group: 'metadata',
      description: 'Visibility, tags, and owner. Changes here don\'t trigger GitHub sync.',
      fields: [
        defineField({
          name: 'visibility',
          title: 'Visibility',
          type: 'string',
          options: {
            list: [
              {title: `Shareable (OK to share outside ${ORG_NAME})`, value: 'shareable'},
              {title: `Confidential (must not be shared outside ${ORG_NAME})`, value: 'confidential'},
            ],
            layout: 'radio',
          },
          initialValue: 'shareable',
        }),
        defineField({
          name: 'tags',
          title: 'Tags',
          type: 'array',
          of: [{type: 'string'}],
          options: {
            layout: 'tags',
          },
        }),
        defineField({
          name: 'owners',
          title: 'Owners',
          type: 'array',
          of: [
            defineArrayMember({
              type: 'object',
              name: 'skillOwner',
              title: 'Owner',
              fields: [
                defineField({name: 'name', title: 'Name', type: 'string', validation: (r) => r.required()}),
                defineField({name: 'email', title: 'Email', type: 'string', validation: (r) => r.required()}),
                defineField({
                  name: 'slackId',
                  title: 'Slack ID',
                  type: 'string',
                  description: 'Optional. Lets the freshness digest @-mention this owner in Slack.',
                }),
              ],
              preview: {
                select: {title: 'name', subtitle: 'email'},
              },
            }),
          ],
          components: {input: OwnersInput},
          description:
            'Who keeps this skill current. Picked from the People directory in this Studio; owners are listed in the weekly freshness digest.',
        }),
        defineField({
          name: 'owner',
          title: 'Owner (legacy)',
          type: 'string',
          readOnly: true,
          hidden: ({parent}) => !parent?.owner,
          description: 'Legacy freeform owner — replaced by Owners above.',
        }),
        defineField({
          name: 'lastReviewedAt',
          title: 'Last Reviewed',
          type: 'datetime',
          readOnly: true,
          description: 'Set by the "Mark reviewed" action. Drives the freshness digest.',
        }),
        defineField({
          name: 'comparison',
          title: 'Comparison with other skills',
          type: 'object',
          readOnly: true,
          description:
            'Set by \u201cCompare with other skills\u201d. What the last comparison found; the details are in Skill comparison results and Similar skill pairs. If the fingerprints no longer match the description and content, it is out of date.',
          fields: [
            defineField({
              name: 'status',
              title: 'Status',
              type: 'string',
              options: {list: ['clear', 'warn', 'hold']},
              description: 'clear: nothing to change, apart from any tips · warn: worth changing · hold: publishing from the Studio is paused until someone sorts it out or allows it.',
            }),
            defineField({name: 'summary', title: 'Summary', type: 'string'}),
            defineField({
              name: 'findings',
              title: 'Findings',
              type: 'array',
              of: [
                defineArrayMember({
                  type: 'object',
                  name: 'comparisonFinding',
                  fields: [
                    defineField({
                      name: 'level',
                      title: 'Level',
                      type: 'string',
                      options: {list: ['hold', 'warn', 'tip']},
                      description: 'hold: publishing paused · warn: worth changing · tip: a suggestion',
                    }),
                    defineField({name: 'field', title: 'About', type: 'string', options: {list: ['description', 'content']}}),
                    defineField({name: 'message', title: 'What was found', type: 'string'}),
                    defineField({name: 'todo', title: 'What to do', type: 'string'}),
                  ],
                  preview: {select: {title: 'message', subtitle: 'todo'}},
                }),
              ],
            }),
            defineField({name: 'descriptionHash', title: 'Description fingerprint', type: 'string'}),
            defineField({name: 'bodyHash', title: 'Content fingerprint', type: 'string'}),
            defineField({name: 'checkedAt', title: 'Compared at', type: 'datetime'}),
            defineField({name: 'model', title: 'Model', type: 'string'}),
          ],
        }),
        defineField({
          name: 'reviewEveryDays',
          title: 'Review Cadence (days)',
          type: 'number',
          initialValue: 90,
          description:
            'How often this skill should be reviewed. Shorten for skills that encode policy or SOPs (e.g. 30).',
          validation: (rule) => rule.min(7).max(365),
        }),
      ],
    }),
    defineField({
      name: 'lastPublishedAt',
      title: 'Last Published to GitHub',
      type: 'datetime',
      readOnly: true,
      fieldset: 'githubSync',
      description: 'Updated automatically when this skill syncs to GitHub.',
    }),
    defineField({
      name: 'lastPublishedCommit',
      title: 'Last Published Commit SHA',
      type: 'string',
      readOnly: true,
      fieldset: 'githubSync',
      description: 'The Git commit from the last sync. Click to view on GitHub.',
    }),
    defineField({
      name: 'lastSyncError',
      title: 'Last Sync Error',
      type: 'text',
      rows: 3,
      readOnly: true,
      fieldset: 'githubSync',
      description: 'If the most recent sync failed to write back metadata after the GitHub commit landed, the error is recorded here. Re-publish the skill to retry.',
    }),
  ],
  preview: {
    select: {
      skillTitle: 'title',
      skillName: 'skillName',
      subtitle: 'description',
      visibility: 'metadata.visibility',
    },
    prepare({skillTitle, skillName, subtitle, visibility}) {
      const displayName = skillTitle || skillName || 'Untitled Skill'
      return {
        title: visibility === 'confidential' ? `\uD83D\uDD12 ${displayName}` : displayName,
        subtitle: subtitle ? `${subtitle.slice(0, 80)}...` : undefined,
        media: BookIcon,
      }
    },
  },
})
