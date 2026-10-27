# Skills Studio

## Content Releases: document IDs and perspectives

The dataset has Content Releases in it, so any document can exist as three
copies: `mySkill`, `drafts.mySkill`, and `versions.<releaseId>.mySkill`. Two
rules keep the custom tools, field components and actions working with all
three.

**Never strip a `drafts.` prefix by hand.** `id.replace(/^drafts\./, '')`
leaves a version ID untouched and then treats it as a published ID — that is
how `drafts.versions.<releaseId>.<id>` gets written and how reference lookups
come back empty. Use the helpers in `utils/documentIds.ts`:

- `getPublishedId(id)` whenever the ID identifies a document *group*:
  references (`skill._ref`), `skillStats` bookkeeping, GitHub sync state.
- `resolveWriteTarget(id)` when a document action writes back. It targets the
  open release version inside a release and the draft everywhere else.

**Pass a perspective to every listing query.** The Studio client is `raw`, and
`documentStore.listenQuery(query, params, {})` inherits it, so a skill sitting
in a release comes back twice — once published, once as its version. Which
perspective to pass depends on what the surface is for, and both live in
`utils/perspective.ts`:

- **Surfaces that describe what is live** use `usePublishedClient()`, or
  `{perspective: 'published'}` as a module-level `listenQuery` option. The
  Skills Explorer is one: its cards are the published catalogue, what
  `npx skills add` installs. Release work shows up there as the pending-release
  notice (`tools/components/useSkillReleases.ts`), never by swapping out the
  content — an explorer that quietly showed release drafts would hand people a
  ZIP that differs from everyone else's install.
- **Surfaces that work on what the editor selected** use
  `usePerspectiveQueryOptions()` / `usePerspectiveClient()`. The Skill Lab is
  one: running an eval against a release's version before it publishes is the
  point of having it.

Either way, drop any `path("drafts.**")` / `path("versions.**")` filter from
those queries — the perspective already does the layering, and a `versions.**`
exclusion would hide the document a release exists to show. The one legitimate
use of `raw` is asking *about* the stored copies rather than reading content
through a perspective, which is what the pending-release hook does.

Related invariants:

- Links between tools and the structure go through `useIntentLink` from
  `sanity/router`, never a hand-built `/structure/...` or `/intent/edit/...`
  href. The router adds the base path and carries the sticky `perspective`
  param, which is what makes a link from inside a release open that release's
  version. Lists in `structure/index.ts` that claim those intents need
  `canHandleIntent`, or the link opens the bare `__edit__` fallback editor.
- A claiming list's `.child()` is what every edit link opens, because intent
  resolution stops at the pane that claims the intent and appends the document
  ID — there is no third segment. Leave those lists' child alone so a
  `documentList` resolves to the document itself; an intermediate list of
  sub-panes would land every link one click short of the form. Per-document
  sub-views belong in `defaultDocumentNode` as view tabs instead, which is
  where the Markdown preview lives.
- Anything that writes to GitHub reads through the **published** perspective:
  both Functions, the `publishToGitHub` action's manifest queries, and
  `scripts/resync-all-skills.ts`. GitHub holds what is live; release content
  gets there when the release publishes.
- Both Function event filters exclude `versions.**`. Without it, editing a
  skill in a release synced it to GitHub early, and discarding a skill from a
  release deleted the live skill's folders from every plugin.
