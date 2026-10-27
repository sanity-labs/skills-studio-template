import {defineCliConfig} from 'sanity/cli'
import {skillsConfig} from './skills.config'

const {projectId, dataset, studioHost, appId} = skillsConfig.sanity

export default defineCliConfig({
  api: {projectId, dataset},
  studioHost,
  deployment: {
    // Empty on the first deploy; paste the app ID `sanity deploy` prints into
    // skills.config.ts so later deploys update the same Studio.
    ...(appId ? {appId} : {}),
    autoUpdates: true,
  },
  typegen: {
    enabled: true,
    path: './**/*.{ts,tsx}',
  },
})
