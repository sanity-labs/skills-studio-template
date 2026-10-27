/**
 * Perspective plumbing for the custom tools.
 *
 * The Studio client is configured with `perspective: 'raw'`, and
 * `documentStore.listenQuery` inherits that whenever no perspective is passed.
 * Raw returns every stored copy of a document, so a skill that sits in a
 * content release comes back twice: once as the published document and once as
 * `versions.<releaseId>.<id>`. In the Skills Explorer that showed up as a
 * duplicate card whose Edit button pointed at a version ID — a document the
 * `allSkills` pane filters out, which is why the pane opened empty.
 *
 * Passing an explicit perspective fixes it either way: Content Lake resolves
 * the document group down to one copy and returns it under its published
 * `_id`. Which perspective depends on what the surface is for:
 *
 * - `usePublishedClient` for surfaces that describe what is live — the Skills
 *   Explorer catalogue, the install commands, anything feeding the GitHub
 *   sync. Release work is surfaced there as a notice, not by swapping out the
 *   content (see tools/components/useSkillReleases.ts).
 * - `usePerspectiveQueryOptions` / `usePerspectiveClient` for surfaces that
 *   work on the content the editor has selected — the Skill Lab, where running
 *   an eval against a release's version before it publishes is the point.
 *
 * See https://www.sanity.io/docs/developer-guides/migrating-plugins-to-support-content-releases
 */
import {useMemo} from 'react'
import {usePerspective, useClient} from 'sanity'

/**
 * `listenQuery` / `client.fetch` options bound to the perspective the Studio is
 * currently showing. Pass this instead of `{}` in every custom tool query that
 * lists or reads content documents.
 *
 * Queries using it must not filter on `path("drafts.**")` or
 * `path("versions.**")`: under a perspective the layering is already done, and
 * a `versions.**` exclusion would drop the very document a release is meant to
 * show.
 */
export function usePerspectiveQueryOptions(tag?: string): {
  perspective: string[]
  tag?: string
} {
  const stackKey = usePerspectiveStackKey()

  return useMemo(
    () => ({perspective: parseStackKey(stackKey), ...(tag ? {tag} : {})}),
    [stackKey, tag],
  )
}

/**
 * A Studio client that reads through the selected perspective, for the
 * one-off `client.fetch` calls a tool makes outside `listenQuery`.
 *
 * The Studio's own client is `raw`; the same caveat as
 * `usePerspectiveQueryOptions` applies to the queries you send through this
 * one. Keep using the plain `useClient()` for writes and for exact-ID reads of
 * a specific copy of a document.
 */
export function usePerspectiveClient(apiVersion: string) {
  const client = useClient({apiVersion})
  const stackKey = usePerspectiveStackKey()

  return useMemo(
    () => client.withConfig({perspective: parseStackKey(stackKey)}),
    [client, stackKey],
  )
}

/**
 * The perspective stack as a primitive, so a consumer's `useMemo` re-runs when
 * the stack's *contents* change and not merely when the array behind it is
 * rebuilt. `usePerspective` recomputes the stack whenever the release list
 * emits, and a fresh array identity on every emit would tear down and re-open
 * every `listenQuery` subscription built from it.
 */
function usePerspectiveStackKey(): string {
  const {perspectiveStack} = usePerspective()
  return perspectiveStack.join(',')
}

function parseStackKey(stackKey: string): string[] {
  // The stack always holds at least one entry in practice. The fallback keeps
  // an unexpected empty one from sending `perspective=` — an invalid param
  // that fails the query and leaves a tool spinning — and reads the safest
  // thing if it ever happens.
  return stackKey ? stackKey.split(',') : ['published']
}

/**
 * A client pinned to the published perspective, for the surfaces that are
 * *about* what is live rather than about what the editor is looking at: the
 * Skills Explorer catalogue and anything feeding the GitHub sync. The Studio's
 * own client reads raw, so without this a document edited in a release shows
 * up alongside its published copy.
 */
export function usePublishedClient(apiVersion: string) {
  const client = useClient({apiVersion})

  return useMemo(() => client.withConfig({perspective: 'published'}), [client])
}
