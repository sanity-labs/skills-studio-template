import type {StructureResolver, DefaultDocumentNodeResolver} from 'sanity/structure'
import {BookIcon, DocumentTextIcon, ClipboardIcon, PlayIcon, BarChartIcon, SplitVerticalIcon, CommentIcon, UsersIcon, TagIcon, UserIcon, WarningOutlineIcon, EyeOpenIcon, LinkIcon, DashboardIcon} from '@sanity/icons'
import {createSlugger} from '../utils/listItemIds'
import {MarkdownPreviewView} from '../components/MarkdownPreviewView'

// A `documentList` only claims an intent on its own when its filter is exactly
// `_type == $type`, and every list here carries a narrower one. Without this,
// an `edit` intent — from the Skills Explorer, the Skill Lab, or global search
// — opens the bare `__edit__` fallback editor instead of the document's pane
// in the structure. See
// https://www.sanity.io/docs/studio/handle-intents-in-structure
//
// Intent resolution stops at the pane that claims the intent and appends the
// document ID, so the claiming list's child is what the link opens. Those
// lists therefore leave `.child()` alone: a `documentList` with a schema type
// resolves to the document itself, which is the form. An intermediate list
// of sub-panes here would mean every edit link landed one click short.
const handlesEditIntentFor =
  (schemaType: string) =>
  (intentName: string, params: {type?: string}) =>
    ['edit', 'create'].includes(intentName) && params.type === schemaType

export const structure: StructureResolver = async (S, context) => {
  const client = context.getClient({apiVersion: '2024-01-01'})

  // One root-pane entry per audience (= per plugin). Auto-installed first.
  // The structure resolver's client reads raw, so the `versions.**` exclusions
  // in these three queries are what keep an audience, tag or owner edited
  // inside a content release from producing a second, duplicate pane.
  const audiences: Array<{_id: string; title: string}> = await client.fetch(
    `*[_type == "audience" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]
      | order(coalesce(autoInstall, false) desc, title asc) {_id, title}`
  )

  return S.list()
    .title('Skills')
    .items([
      // All Skills
      S.listItem()
        .title('All Skills')
        .icon(BookIcon)
        .child(
          S.documentList()
            .title('All Skills')
            .filter('_type == "skill" && !(_id in path("versions.**"))')
            .schemaType('skill')
            // The one pane that claims skill intents: it lists every skill,
            // where the audience/tag/owner lists below would each only hold a
            // subset. Links from the Skills Explorer and Skill Lab, and hits
            // in global search, land here.
            .canHandleIntent(handlesEditIntentFor('skill'))
        ),

      // Audience sections — one per plugin; drives GitHub plugin routing
      S.divider(),
      ...audiences.map((audience) =>
        S.listItem()
          .title(audience.title)
          .id(`audience-${audience._id}`)
          .icon(UsersIcon)
          .child(
            S.documentList()
              .title(audience.title)
              .id(`audience-skills-${audience._id}`)
              .filter('_type == "skill" && !(_id in path("versions.**")) && $audienceId in audiences[]._ref')
              .params({audienceId: audience._id})
              .schemaType('skill')
          ),
      ),

      // Tag browsing — built from the tags actually in use
      S.divider(),
      S.listItem()
        .title('Browse by Tag')
        .id('browseByTag')
        .icon(TagIcon)
        .child(async () => {
          const tags: string[] = await client.fetch(
            `array::unique(*[_type == "skill" && !(_id in path("drafts.**"))
              && !(_id in path("versions.**"))].metadata.tags[])`
          )
          const slugify = createSlugger()
          return S.list()
            .title('Tags')
            .id('tags')
            .items(
              tags
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b))
                .map((tag) => {
                  const slug = slugify(tag)
                  return S.listItem()
                    .title(tag)
                    .id(`tag-${slug}`)
                    .icon(TagIcon)
                    .child(
                      S.documentList()
                        .title(tag)
                        .id(`tag-skills-${slug}`)
                        .filter('_type == "skill" && !(_id in path("versions.**")) && $tag in metadata.tags')
                        .params({tag})
                        .schemaType('skill')
                    )
                }),
            )
        }),

      S.listItem()
        .title('Browse by Owner')
        .id('browseByOwner')
        .icon(UserIcon)
        .child(async () => {
          const owners: Array<{name: string | null; email: string | null}> = await client.fetch(
            `*[_type == "skill" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
              && count(metadata.owners) > 0].metadata.owners[]{name, email}`
          )
          const byEmail = new Map<string, string>()
          for (const o of owners) {
            if (o?.email && !byEmail.has(o.email)) byEmail.set(o.email, o.name || o.email)
          }
          const slugifyOwner = createSlugger()
          const sorted = [...byEmail.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([email, name]) => ({email, name, slug: slugifyOwner(email)}))
          return S.list()
            .title('Owners')
            .id('owners')
            .items([
              S.listItem()
                .title('Unowned — adopt me')
                .id('owner-unowned')
                .icon(WarningOutlineIcon)
                .child(
                  S.documentList()
                    .title('Unowned skills')
                    .id('owner-unowned-skills')
                    .filter('_type == "skill" && !(_id in path("versions.**")) && !defined(metadata.owners)')
                    .schemaType('skill')
                ),
              S.divider(),
              ...sorted.map(({email, name, slug}) =>
                S.listItem()
                  .title(name)
                  .id(`owner-${slug}`)
                  .icon(UserIcon)
                  .child(
                    S.documentList()
                      .title(name)
                      .id(`owner-skills-${slug}`)
                      .filter('_type == "skill" && !(_id in path("versions.**")) && $email in metadata.owners[].email')
                      .params({email})
                      .schemaType('skill')
                  ),
              ),
            ])
        }),

      // Management section
      S.divider(),
      S.listItem()
        .title('Audiences')
        .icon(UsersIcon)
        .child(S.documentTypeList('audience').title('Audiences')),
      // Org directory for the skill owner picker
      S.listItem()
        .title('People')
        .icon(UserIcon)
        .child(S.documentTypeList('orgPerson').title('People')),
      S.listItem()
        .title('All References')
        .icon(DocumentTextIcon)
        .child(
          S.documentList()
            .title('All Reference Files')
            .filter('_type == "skillReference" && !(_id in path("versions.**"))')
            .schemaType('skillReference')
            .canHandleIntent(handlesEditIntentFor('skillReference'))
        ),

      // Eval & Stats section
      S.divider(),
      S.listItem()
        .title('Eval Test Cases')
        .icon(ClipboardIcon)
        .child(
          S.documentList()
            .title('Eval Test Cases')
            .filter('_type == "skillEval" && !(_id in path("versions.**"))')
            .schemaType('skillEval')
            .canHandleIntent(handlesEditIntentFor('skillEval'))
        ),
      S.listItem()
        .title('Eval Runs')
        .icon(PlayIcon)
        .child(
          S.documentList()
            .title('Eval Runs')
            .filter('_type == "skillEvalRun" && !(_id in path("versions.**"))')
            .defaultOrdering([{field: '_createdAt', direction: 'desc'}])
            .schemaType('skillEvalRun')
            .canHandleIntent(handlesEditIntentFor('skillEvalRun'))
        ),
      S.listItem()
        .title('Skill Stats')
        .icon(BarChartIcon)
        .child(
          S.documentList()
            .title('Skill Stats')
            .filter('_type == "skillStats" && !(_id in path("versions.**"))')
            .schemaType('skillStats')
        ),
      S.listItem()
        .title('Similar skill pairs')
        .icon(LinkIcon)
        .child(
          S.documentList()
            .title('Similar skill pairs')
            .filter('_type == "skillRelation"')
            .defaultOrdering([{field: 'description.competing', direction: 'desc'}])
            .schemaType('skillRelation')
            .canHandleIntent(handlesEditIntentFor('skillRelation'))
        ),
      S.listItem()
        .title('Skill comparison results')
        .icon(DashboardIcon)
        .child(
          S.documentList()
            .title('Skill comparison results')
            .filter('_type == "skillQuality"')
            .schemaType('skillQuality')
            .canHandleIntent(handlesEditIntentFor('skillQuality'))
        ),

      // Prose tests section — author/manage sessions + browse votes
      S.divider(),
      S.listItem()
        .title('Prose test sessions')
        .id('proseTestSessions')
        .icon(SplitVerticalIcon)
        .child(
          S.documentList()
            .title('Prose test sessions')
            .id('proseTestSessions')
            .filter('_type == "proseTestSession" && !(_id in path("versions.**"))')
            .defaultOrdering([{field: 'createdAt', direction: 'desc'}])
            .schemaType('proseTestSession')
        ),
      S.listItem()
        .title('Prose votes')
        .id('proseVotes')
        .icon(CommentIcon)
        .child(
          S.documentList()
            .title('Prose votes')
            .id('proseVotes')
            .filter('_type == "proseVote" && !(_id in path("versions.**"))')
            .defaultOrdering([{field: 'submittedAt', direction: 'desc'}])
            .schemaType('proseVote')
        ),
    ])
}

// Skills and reference files are Markdown, and the editor shows source. The
// preview tab renders it — for a skill, together with the reference files it
// ships with, which is the whole of what an agent loads.
const PREVIEWABLE_TYPES = ['skill', 'skillReference']

export const defaultDocumentNode: DefaultDocumentNodeResolver = (S, {schemaType}) => {
  if (!PREVIEWABLE_TYPES.includes(schemaType)) {
    return S.document().views([S.view.form()])
  }

  return S.document().views([
    S.view.form(),
    S.view.component(MarkdownPreviewView).id('preview').title('Preview').icon(EyeOpenIcon),
  ])
}
