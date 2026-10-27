/**
 * Skill paths are audience-routed: `<pluginFolder>/skills/<skillName>/…`,
 * computed by studio/utils/audiences.ts from the `audience` documents.
 * The Everyone audience uses the `everyonePluginName` folder from
 * skills.config.ts.
 *
 * Symlinks at `skills/` and `.agents/skills/` point into that folder for
 * local convenience, but the Git Trees API does NOT follow symlinks —
 * never construct GitHub write paths through them.
 */
import {skillsConfig} from '../skills.config'

export const REPO_OWNER = skillsConfig.github.owner
export const REPO_NAME = skillsConfig.github.repo
export const REPO_BRANCH = skillsConfig.github.branch
export {REPO_URL, STUDIO_URL} from '../skills.config'

export const ORG_NAME = skillsConfig.orgName

/** This Studio's own project, named in prompts for agents using the Sanity MCP. */
export const SANITY_PROJECT_ID = skillsConfig.sanity.projectId
export const SANITY_DATASET = skillsConfig.sanity.dataset
