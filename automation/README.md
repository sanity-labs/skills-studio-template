# Automation (optional)

Org-scoped scheduled Sanity Functions. Nothing in the core publish pipeline
depends on this stack — deploy it once the Studio is running and you want
the weekly freshness digest.

## freshness-digest

Every Monday, posts a Slack message listing skills that are past their review
cadence (`metadata.reviewEveryDays`, default 90 days), grouped by owner.
Owners with a Slack ID on their People entry are @-mentioned. Each line links
to the skill in the Studio, where the owner can check it and click
**Mark reviewed**.

### Setup

1. Set `sanity.organizationId` (and `studioHost`) in `studio/skills.config.ts`.
2. Create a Slack [incoming webhook](https://api.slack.com/messaging/webhooks)
   for the channel that should receive the digest.
3. From this directory:

   ```bash
   pnpm install
   npx sanity blueprints init . --stack-name automation --organization-id <your-org-id>
   npx sanity blueprints deploy
   npx sanity functions env add freshness-digest SLACK_WEBHOOK_URL <webhook-url>
   ```

Not on Slack? The handler builds a plain-text message and POSTs `{text}` to a
webhook — swap the final `fetch` for Teams, Google Chat, or email.

## Syncing People from an existing directory

The skill owner picker reads `orgPerson` documents from the skills project.
You can manage them by hand in the Studio or load a CSV with
`studio/scripts/import-people.ts`. To keep them in sync with an HRIS or
another system, add a scheduled function here that upserts
`orgPerson` documents (`_id: orgPerson-<stable-id>`, fields `name`, `email`,
optional `slackId`, `jobTitle`, `avatarUrl`) and deletes people who have left.
Give it a robot token with `editor` on the skills project.
