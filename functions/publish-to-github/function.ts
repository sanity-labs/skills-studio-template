import {defineDocumentFunction} from '@sanity/blueprints'

// Last deployed: trigger CI test

export const publishToGitHubFunction = defineDocumentFunction({
  name: 'publish-to-github',
  event: {
    on: ['create', 'update'],
    // Delta GROQ filter: trigger on skill content changes OR skillReference content changes.
    //
    // Why the `delta::operation() == 'create'` branch:
    //   On document creation, before() is null, so delta::changedAny(...) returns
    //   false for every field — there's no diff baseline. Without this branch,
    //   first-publish of a brand-new skill silently skipped sync.
    //   See https://www.sanity.io/docs/specifications/groq-functions § Filtering on
    //   changes only works if there's something to change.
    //
    // Metadata fields (lastPublishedAt, lastPublishedCommit, lastSyncError) are
    // intentionally excluded from delta::changedAny so updates from this Function
    // don't re-trigger themselves (recursion guard). The create-branch is safe
    // because metadata fields aren't set on a first-publish event.
    // See CONTRIBUTING.md for details.
    //
    // `versions.**` is excluded alongside `drafts.**`: a skill edited inside a
    // content release is stored as `versions.<releaseId>.<id>`, and syncing
    // that would publish the release's content to GitHub before the release
    // itself publishes. The release's own publish rewrites the published
    // document, which fires this Function normally.
    filter: `
      !(_id in path('drafts.**'))
      && !(_id in path('versions.**'))
      && (
        (_type == 'skill' && (
          delta::operation() == 'create'
          || delta::changedAny((skillName, description, content, references, audiences, invocation))
        ))
        || (_type == 'skillReference' && (
          delta::operation() == 'create'
          || delta::changedAny((content, filename))
        ))
      )
    `,
    projection: `{
      _id,
      _type,
      skillName,
      description,
      content,
      filename,
      references[]->{filename, content},
      "metadata": metadata { tags, visibility, owner, owners },
      invocation,
      "audiences": audiences[]->{
        "slug": slug.current, title, pluginTitle, pluginDescription, autoInstall, pluginName
      }
    }`,
  },
})
