#!/usr/bin/env node
/**
 * Interactive first-run setup for a Skills Studio fork.
 *
 * Fills in studio/skills.config.ts and renames the org-wide plugin folder
 * (plus the `skills` / `.agents/skills` symlinks) to match. Re-runnable:
 * current values are offered as defaults.
 *
 *   pnpm run setup        (or: node scripts/setup.mjs)
 */
import {readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, symlinkSync, lstatSync} from 'node:fs'
import {execSync} from 'node:child_process'
import {createInterface} from 'node:readline/promises'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'studio/skills.config.ts')
let config = readFileSync(configPath, 'utf8')

// Interactive in a terminal; when stdin is piped (CI, scripted setup), answers
// are read one per line up front — readline drops lines that arrive before
// the question is asked.
const piped = process.stdin.isTTY ? null : readFileSync(0, 'utf8').split(/\r?\n/)
const rl = piped ? null : createInterface({input: process.stdin, output: process.stdout})

/** Read the current string value of `key:` inside the block that starts with `block`. */
function current(key, block) {
  const scope = block ? config.slice(config.indexOf(`${block}: {`)) : config
  return scope.match(new RegExp(`\\b${key}: '([^']*)'`))?.[1] ?? ''
}

function set(key, value, block) {
  const start = block ? config.indexOf(`${block}: {`) : 0
  const re = new RegExp(`(\\b${key}: )'[^']*'`)
  const head = config.slice(0, start)
  const tail = config.slice(start).replace(re, `$1'${value.replace(/'/g, "\\'")}'`)
  config = head + tail
}

async function ask(question, fallback, validate) {
  for (;;) {
    const prompt = `${question}${fallback ? ` [${fallback}]` : ''}: `
    const raw = piped ? (process.stdout.write(prompt + '\n'), piped.shift() ?? '') : await rl.question(prompt)
    const answer = raw.trim() || fallback
    if (piped && validate?.(answer)) throw new Error(`Invalid answer for "${question}": ${validate(answer)}`)
    const problem = validate?.(answer)
    if (!problem) return answer
    console.log(`  ${problem}`)
  }
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const isSlug = (s) => (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) ? null : 'Use lowercase letters, numbers and hyphens.')
const required = (s) => (s ? null : 'Required.')

function gitRemote() {
  try {
    const url = execSync('git remote get-url origin', {cwd: root, stdio: ['ignore', 'pipe', 'ignore']})
      .toString()
      .trim()
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/)
    return m ? {owner: m[1], repo: m[2]} : null
  } catch {
    return null
  }
}

console.log('\nSkills Studio setup — press Enter to keep the value in brackets.\n')

const orgName = await ask('Organization name', current('orgName') === 'Acme' ? '' : current('orgName'), required)
const orgSlug = slug(orgName)

console.log('\nSanity — create a project at https://www.sanity.io/manage (or run `npx sanity init` in studio/).')
const projectIdDefault = current('projectId', 'sanity')
const projectId = await ask(
  'Sanity project ID',
  projectIdDefault === 'your-project-id' ? '' : projectIdDefault,
  (v) => (/^[a-z0-9]+$/.test(v) ? null : 'Project IDs are lowercase letters and numbers.'),
)
const dataset = await ask('Dataset', current('dataset', 'sanity') || 'production', isSlug)
const studioHost = await ask(
  'Studio hostname (<host>.sanity.studio)',
  current('studioHost', 'sanity') === 'acme-skills-studio' ? `${orgSlug}-skills` : current('studioHost', 'sanity'),
  isSlug,
)
const organizationId = await ask(
  'Sanity organization ID (optional, for the automation stack)',
  current('organizationId', 'sanity'),
)
const samlLoginUrl = await ask('SAML SSO login URL (optional — Enter to use standard Sanity login)', current('samlLoginUrl', 'auth'))

const remote = gitRemote()
console.log('\nGitHub — the repo skills are published to (this fork).')
const owner = await ask(
  'GitHub owner (org or user)',
  remote?.owner || (current('owner', 'github') === 'acme' ? '' : current('owner', 'github')),
  required,
)
const repo = await ask(
  'GitHub repo name',
  remote?.repo || (current('repo', 'github') === 'skills' && current('owner', 'github') === 'acme' ? '' : current('repo', 'github')),
  required,
)
const branch = await ask('Branch', current('branch', 'github') || 'main', required)

console.log('\nPlugin marketplace — what people type to install skills.')
const marketplaceName = await ask(
  'Marketplace name',
  current('name', 'marketplace') === 'acme-skills' ? `${orgSlug}-skills` : current('name', 'marketplace'),
  isSlug,
)
// Required: it is published in every marketplace and plugin manifest, so
// skipping it would ship the template's placeholder address.
const authorEmail = await ask(
  'Contact email for the marketplace (shown in plugin listings)',
  current('email', 'author') === 'ai@acme.example' ? '' : current('email', 'author'),
  (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter an email address.'),
)
const oldFolder = current('everyonePluginName')
const everyonePluginName = await ask(
  'Folder/plugin name for org-wide skills',
  oldFolder === 'org-skills' ? `${orgSlug}-everyone` : oldFolder,
  isSlug,
)
rl?.close()

set('orgName', orgName)
set('projectId', projectId, 'sanity')
set('dataset', dataset, 'sanity')
set('organizationId', organizationId, 'sanity')
set('studioHost', studioHost, 'sanity')
set('samlLoginUrl', samlLoginUrl, 'auth')
set('owner', owner, 'github')
set('repo', repo, 'github')
set('branch', branch, 'github')
set('name', marketplaceName, 'marketplace')
set('displayName', `${orgName} Skills`, 'marketplace')
set('description', `AI agent skills for ${orgName} teams.`, 'marketplace')
set('name', orgName, 'author')
set('email', authorEmail, 'author')
set('url', current('url', 'author') === 'https://acme.example' ? `https://github.com/${owner}` : current('url', 'author'), 'author')
set('everyonePluginName', everyonePluginName)
writeFileSync(configPath, config)
console.log(`\n✔ Wrote studio/skills.config.ts`)

// Rename the org-wide plugin folder and repoint the convenience symlinks.
if (oldFolder !== everyonePluginName && existsSync(join(root, oldFolder))) {
  renameSync(join(root, oldFolder), join(root, everyonePluginName))
  for (const [link, target] of [
    ['skills', `${everyonePluginName}/skills`],
    ['.agents/skills', `../${everyonePluginName}/skills`],
  ]) {
    const path = join(root, link)
    try {
      if (lstatSync(path).isSymbolicLink()) unlinkSync(path)
    } catch {}
    symlinkSync(target, path)
  }
  console.log(`✔ Renamed ${oldFolder}/ → ${everyonePluginName}/ and updated symlinks`)
}

console.log(`
Next steps (details in README.md § "Set up your own Skills Studio"):

  1. pnpm install                                 # at the repo root (studio/ + functions/)
  2. cd studio && pnpm dev                        # run the Studio locally
  3. APPLY=1 npx sanity exec scripts/seed.ts --with-user-token
  4. npx sanity deploy                            # then paste the appId into skills.config.ts
  5. Deploy the GitHub sync Functions, from the repo root (cd ..):
       npx sanity blueprints init . --stack-name skills-publishing --project-id ${projectId}
       npx sanity blueprints deploy
       npx sanity functions env add publish-to-github GITHUB_TOKEN <token>
       npx sanity functions env add publish-to-github SANITY_WRITE_TOKEN <token>
       npx sanity functions env add delete-from-github GITHUB_TOKEN <token>
  6. Publish the "writing-skills" example skill in the Studio and watch it land on GitHub.
`)
