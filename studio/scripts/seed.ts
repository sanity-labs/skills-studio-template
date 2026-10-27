/**
 * Seed a fresh Skills Studio dataset with the minimum it needs to publish:
 * the "Everyone" audience (mapped to `everyonePluginName` from
 * skills.config.ts) and one example skill that teaches people how to write
 * skills here. Safe to re-run: existing documents are left alone.
 *
 * Dry run (default) prints what it would create. APPLY=1 writes.
 *
 *   cd studio
 *   npx sanity exec scripts/seed.ts --with-user-token
 *   APPLY=1 npx sanity exec scripts/seed.ts --with-user-token
 *
 * Publishing the example skill in the Studio afterwards is what triggers the
 * first GitHub sync — it is created as a draft so you can review it first.
 */
import {getCliClient} from 'sanity/cli'
import {skillsConfig} from '../skills.config'

const apply = process.env.APPLY === '1'
const client = getCliClient({apiVersion: '2025-02-19'})
const {orgName, everyonePluginName} = skillsConfig

const everyone = {
  _id: 'audience-everyone',
  _type: 'audience',
  title: 'Everyone',
  slug: {_type: 'slug', current: 'everyone'},
  pluginName: everyonePluginName,
  pluginTitle: `${orgName} org-wide skills`,
  pluginDescription: `Org-wide ${orgName} skills every employee benefits from: writing, working with skills, and shared processes.`,
  autoInstall: true,
}

const exampleSkill = {
  _id: 'drafts.skill-writing-skills',
  _type: 'skill',
  skillName: 'writing-skills',
  title: 'Writing skills',
  description: `Helps ${orgName} employees write or improve an AI agent skill for the ${orgName} Skills Studio. Use when someone wants to turn a process, playbook, or piece of expertise into a skill, asks how to write a good skill description, or wants feedback on a draft skill. Not for using an existing skill — for that, use the plugin overview skill.`,
  content: `# Writing skills

A skill is a set of instructions an AI agent loads when a request matches its **description**. Skills are authored in the ${orgName} Skills Studio and published to every audience plugin they belong to.

## When helping someone write a skill

1. Ask what task the skill helps with and who will use it. One skill, one job.
2. Draft the **description** first. It is the only part the agent sees before deciding to load the skill:
   - First sentence: what problem it solves, in the words of someone who needs it.
   - When to use it: situations people are in, or things they would actually type.
   - What it is *not* for, and which skill handles that instead.
   - Third person, under 1024 characters. Leave out how it works.
3. Write the **content** as direct instructions to the agent: steps, decisions, examples, and the output format expected. Keep it under ~5k tokens.
4. Move long material (tables, templates, policies) into **reference files**. The agent loads them on demand.
5. Pick the narrowest **audience** that fits. Use *Everyone* only for genuinely org-wide skills.
6. Add an **owner** and a review cadence so the skill stays current.

## Before publishing

- Run **Test skill** and **Check overlap** from the document actions in the Studio.
- Add a few eval test cases in the Skill Lab: requests that should trigger the skill, and near-misses that should not.
`,
  audiences: [{_key: 'everyone', _type: 'reference', _ref: everyone._id}],
  metadata: {visibility: 'shareable', tags: ['skills', 'authoring']},
}

async function main() {
  const existing = await client.fetch<string[]>(`*[_id in $ids]._id`, {
    ids: [everyone._id, 'skill-writing-skills', exampleSkill._id],
  })
  const tx = client.transaction()
  let planned = 0

  if (existing.includes(everyone._id)) {
    console.log(`= audience "Everyone" already exists`)
  } else {
    console.log(`+ audience "Everyone" → plugin folder "${everyonePluginName}" (published)`)
    tx.create(everyone)
    planned++
  }

  if (existing.some((id) => id.endsWith('skill-writing-skills'))) {
    console.log(`= example skill "writing-skills" already exists`)
  } else {
    console.log(`+ example skill "writing-skills" (draft — publish it in the Studio to run the first sync)`)
    tx.create(exampleSkill)
    planned++
  }

  if (!planned) return console.log('\nNothing to do.')
  if (!apply) return console.log('\nDry run. Re-run with APPLY=1 to write.')
  await tx.commit()
  console.log('\nSeeded.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
