# Skills Studio

Run your own **AI agent skills platform** on [Sanity](https://www.sanity.io). Your teams write and review skills in a Sanity Studio; publishing a skill commits it to this GitHub repo, which doubles as a plugin marketplace for **Claude Code, Cursor, GitHub Copilot and OpenAI Codex**, as well as the [`skills` CLI](https://github.com/vercel-labs/skills).

Fork it, run one setup command, deploy, and your org has a governed home for its skills.

## What you get

- **A Studio for authoring skills.** A structured editor for `SKILL.md` content, its description and its reference files, with owners, tags, visibility and review cadence.
- **Publish → GitHub.** A Sanity Function renders each published skill to `SKILL.md` + `references/` and commits it atomically. It also regenerates the marketplace manifests for every supported tool and keeps a per-plugin overview skill current.
- **Audience-based plugins.** Each **audience** (Everyone, Engineering, Sales…) becomes its own installable plugin, so people only load the skills meant for them.
- **Quality tooling.**
  - *Skills Explorer*: browse, download ZIPs and try skills in a chat playground.
  - *Skill Lab*: trigger and selection evals.
  - *Check overlap*: catches skills that compete for the same requests.
  - *Improve description* and *Test skill* actions.
  - *Prose Pick*: A/B tests of writing quality across models and skills.
- **Freshness.** Review cadences, an overdue badge, *Mark reviewed*, and an optional weekly Slack digest that pings owners.

```
Skills Studio (Sanity) ──publish──▶ Sanity Function ──Git Trees API──▶ GitHub repo (this fork)
                                                                         ├─ <plugin>/skills/<skill>/SKILL.md
                                                                         └─ marketplace manifests ──▶ Claude Code · Cursor · Copilot · Codex
```

## Set up your own Skills Studio

You'll need Node 22+, [pnpm](https://pnpm.io), a [Sanity account](https://www.sanity.io/get-started) and a GitHub org or account.

### 1. Fork and configure

1. **Create your repo.** Click **Use this template** (or fork), then clone your copy. A **private** repo is recommended, since skills often contain internal process.
2. **Create a Sanity project** at [sanity.io/manage](https://www.sanity.io/manage), or run `npx sanity@latest init --bare`. Note the project ID.
3. **Run the setup script** from the repo root:

   ```bash
   pnpm run setup
   ```

   It asks for your org name, Sanity project, GitHub repo and marketplace name. It writes everything to **`studio/skills.config.ts`**, the one file that holds org-specific settings, and renames the org-wide plugin folder to match. You can also edit that file by hand.

### 2. Run and seed the Studio

```bash
cd studio
pnpm install
pnpm dev                                            # http://localhost:3333
APPLY=1 npx sanity exec scripts/seed.ts --with-user-token
```

The seed creates the **Everyone** audience and a draft example skill, `writing-skills`. In [sanity.io/manage](https://www.sanity.io/manage) → API → CORS origins, add `http://localhost:3333` if prompted.

### 3. Deploy the Studio

```bash
npx sanity deploy
```

Paste the printed **app ID** into `sanity.appId` in `skills.config.ts` so later deploys update the same Studio. Then invite your colleagues in sanity.io/manage → Members.

**SSO (optional).** If your Sanity org has SAML configured, set `auth.samlLoginUrl` in `skills.config.ts`.

### 4. Deploy the GitHub sync

The sync runs as two [Sanity Functions](https://www.sanity.io/docs/functions), deployed with Blueprints. First, create two tokens:

| Token | Where to create it | Permissions |
|---|---|---|
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) | This repo only: **Contents: Read and write** |
| `SANITY_WRITE_TOKEN` | sanity.io/manage → your project → API → Tokens | **Editor**. Lets the Function write the sync status back onto the skill. |

Then deploy **from the repo root**, where `sanity.blueprint.ts` sits next to `pnpm-lock.yaml`:

```bash
pnpm install                # once, at the root: installs studio/ and functions/
npx sanity blueprints init . --stack-name skills-publishing --project-id <project-id>
npx sanity blueprints deploy
npx sanity functions env add publish-to-github GITHUB_TOKEN <github-token>
npx sanity functions env add publish-to-github SANITY_WRITE_TOKEN <sanity-token>
npx sanity functions env add delete-from-github GITHUB_TOKEN <github-token>
```

Now open the `writing-skills` draft in the Studio and click **Publish**. Within a few seconds the sync banner shows a commit link. Your repo now has `<everyone-plugin>/skills/writing-skills/SKILL.md`, a generated overview skill and four marketplace manifests.

**Manual fallback.** The **Sync to GitHub** document action does the same commit from the browser. It asks once for a GitHub token, which is stored in the Studio's secrets.

### 5. Turn on CI (optional)

The workflows in `.github/workflows/` redeploy the Studio and Functions on push to your branch. Under Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `SANITY_DEPLOY_TOKEN` | A Sanity token with **Deploy Studio** (or Administrator) permissions |
| Variable | `SANITY_PROJECT_ID` | Your project ID. Deploy jobs are skipped until it is set. |
| Variable | `SANITY_ORGANIZATION_ID` | Your Sanity org ID |
| Variable | `SANITY_BLUEPRINT_STACK_ID` | From `npx sanity blueprints info`. The Functions deploy is skipped until it is set. |

`validate-skills.yml` runs [skill-validator](https://github.com/dacharyc/skill-validator) on skills changed in pull requests.

### 6. Optional extras

- **People directory.** The owner picker reads **People** documents. Add them in the Studio, or bulk-load a CSV (`name,email,slackId,jobTitle,avatarUrl`):
  `npx sanity exec scripts/import-people.ts --with-user-token -- people.csv`
- **AI features.** *Test skill*, *Improve description* and the chat playground use Sanity's [Agent Actions](https://www.sanity.io/docs/agent-actions). The Skill Lab and *Check overlap* call model providers directly. Add Anthropic, OpenAI, Gemini or OpenRouter keys through the key dialog in those tools; they're stored as Studio secrets.
- **Weekly freshness digest.** A Slack post of overdue skills, grouped by owner. See [`automation/README.md`](automation/README.md).
- **More audiences.** Create an **Audience** document per group (e.g. *Engineering*, slug `engineering`). Its slug becomes the plugin name. Tag skills with it and they publish into that plugin.

## Installing skills

The Skills Explorer in your Studio has copy-paste install commands for each plugin. In general form:

```bash
# Claude Code
claude plugin marketplace add <owner>/<repo>
claude plugin install <plugin>@<marketplace-name>

# Cursor 2.5+ (in Cursor chat)
/plugin marketplace add <owner>/<repo>
/plugin install <plugin>@<marketplace-name>

# GitHub Copilot CLI
copilot plugin marketplace add <owner>/<repo>
copilot plugin install <plugin>@<marketplace-name>

# OpenAI Codex CLI
codex plugin marketplace add <owner>/<repo>
codex plugin add <plugin>@<marketplace-name>

# Any tool, one-shot via the skills CLI
npx skills add git@github.com:<owner>/<repo>.git --skill <skill-name>
```

**Claude apps (Team / Enterprise).** An org owner can add this repo as an organization plugin marketplace and mark the Everyone plugin as installed by default. That way every member gets the org-wide skills, and other audiences are one click away.

> **⚠️ Private skills in public repos.** `npx skills add` installs into the current project (e.g. `.claude/skills/`) by default. If that project is public, committing it leaks your skills. Install with `-g` (user scope), or add the skills folder to `.gitignore`.

## Repo layout

```
sanity.blueprint.ts         Functions stack (at the root, next to pnpm-lock.yaml)
functions/
  publish-to-github/        Sanity Function: render + commit on publish
  delete-from-github/       Sanity Function: remove on unpublish/delete
studio/
  skills.config.ts          ← the one file you edit: org, project, repo, marketplace
  schemaTypes/              skill, skillReference, audience, orgPerson (People), evals, stats…
  actions/ tools/ components/ structure/ utils/   (utils/ is shared with functions/)
  scripts/                  seed, import-people, import-skill-from-repo, resync-all-skills, evals
automation/                 optional org-scoped scheduled functions (freshness digest)
scripts/setup.mjs           interactive first-run setup
<everyone-plugin>/          org-wide plugin (default folder: org-skills)
  skills/<skill>/SKILL.md   generated by the sync, so don't edit by hand
<audience>/                 one folder per additional audience, generated
.claude-plugin/ .cursor-plugin/ .github/plugin/ .agents/plugins/   generated marketplace manifests
skills → <everyone-plugin>/skills   convenience symlink (never write through it via the API)
```

## Working on it

```bash
pnpm test                    # from the repo root: vitest across studio/ and functions/
cd studio && pnpm typegen    # after schema or GROQ changes
```

Further reading:

- [`studio/SYNC-ARCHITECTURE.md`](studio/SYNC-ARCHITECTURE.md): how the sync works, including the symlink caveat and failure modes
- [`CONTRIBUTING.md`](CONTRIBUTING.md): authoring workflow, skills that arrive by PR, and sync-triggering fields
- [`AGENTS.md`](AGENTS.md): orientation for AI agents working in this repo
- [`docs/adr/`](docs/adr/): design decisions
