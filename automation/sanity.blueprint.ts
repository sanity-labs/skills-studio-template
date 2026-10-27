import {defineBlueprint, defineScheduledFunction, defineRobotToken} from '@sanity/blueprints'
import {skillsConfig} from '../studio/skills.config'

/**
 * Optional org-scoped automation stack (scheduled functions require
 * organization scope, so this is separate from the project-scoped GitHub
 * publishing stack in studio/).
 *
 * freshness-digest: weekly Slack post listing skills whose last review (or
 * last edit) is older than their review cadence, grouped by owner, with
 * <@slackId> mentions for owners who have a Slack ID.
 *
 * Setup (see automation/README.md):
 *  1. Set sanity.organizationId in studio/skills.config.ts
 *  2. npx sanity blueprints init . --stack-name automation --organization-id <your-org-id>
 *  3. npx sanity functions env add freshness-digest SLACK_WEBHOOK_URL <incoming webhook URL>
 *  4. npx sanity blueprints deploy
 */
export default defineBlueprint({
  resources: [
    defineRobotToken({
      name: 'skills-reader',
      label: 'Skills freshness digest reader',
      memberships: [
        {
          resourceType: 'project',
          resourceId: skillsConfig.sanity.projectId,
          roleNames: ['viewer'],
        },
      ],
    }),
    defineScheduledFunction({
      name: 'freshness-digest',
      // Daily 08:00 UTC; the handler itself only posts on Mondays.
      // (Workaround: day-of-week cron fields have been unreliable on the
      // platform, so the weekday check lives in the handler.)
      event: {expression: '0 8 * * *'},
      robotToken: '$.resources.skills-reader.token',
    }),
  ],
})
