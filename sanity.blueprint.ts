import {defineBlueprint} from '@sanity/blueprints'
import {publishToGitHubFunction} from './functions/publish-to-github/function'
import {deleteFromGitHubFunction} from './functions/delete-from-github/function'

// Project-scoped stack: the GitHub sync Functions. Lives at the repo root next
// to pnpm-lock.yaml so the CLI detects pnpm (see
// https://www.sanity.io/docs/blueprints/project-layout-and-monorepos).
// Each Function's code is in ./functions/<name>, the default `src`.
export default defineBlueprint({
  resources: [publishToGitHubFunction, deleteFromGitHubFunction],
})
