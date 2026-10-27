import {defineDocumentFunction} from '@sanity/blueprints'

export const deleteFromGitHubFunction = defineDocumentFunction({
  name: 'delete-from-github',
  event: {
    on: ['delete'],
    // Only the published document disappearing means the skill is gone.
    // Discarding a skill from a content release, or archiving the release,
    // deletes `versions.<releaseId>.<id>` — without this guard that swept the
    // live skill's folders out of every plugin in the repo.
    filter: `_type == "skill" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))`,
    projection: `{ _id, skillName }`,
  },
})
