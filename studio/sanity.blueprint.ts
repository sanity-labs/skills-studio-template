import {defineBlueprint} from '@sanity/blueprints'
import {publishToGitHubFunction} from './functions/publish-to-github/function'
import {deleteFromGitHubFunction} from './functions/delete-from-github/function'

// Blueprint: GitHub publishing (project-scoped stack)
export default defineBlueprint({
  resources: [publishToGitHubFunction, deleteFromGitHubFunction],
})
