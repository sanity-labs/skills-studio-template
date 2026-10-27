# Skills Studio — Studio

The Sanity Studio and Functions for managing AI agent skills. Configuration lives in [`skills.config.ts`](skills.config.ts); first-time setup is in the [root README](../README.md#set-up-your-own-skills-studio).

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:3333
```

## Deploy

```bash
pnpm sanity deploy                         # Studio → https://<studioHost>.sanity.studio
npx sanity blueprints deploy               # Functions (publish-to-github, delete-from-github)
```

Both redeploy from GitHub Actions on push once the repo variables are set (see the root README, § "Turn on CI").

## Functions

- **`publish-to-github`** renders the skill into each audience's plugin folder, regenerates the marketplace and plugin manifests and overview skills, and commits it all atomically. Env: `GITHUB_TOKEN`, `SANITY_WRITE_TOKEN`.
- **`delete-from-github`** removes the skill's folders when it is unpublished or deleted, then regenerates the manifests. Env: `GITHUB_TOKEN`.

## Schema types

- **`skill`**: the skill itself, with frontmatter fields, content, references, audiences, invocation, metadata (owners, tags, visibility, review cadence) and sync state
- **`skillReference`**: a reference file belonging to a skill
- **`audience`**: a consumer group; one per plugin
- **`orgPerson`** (People): the directory behind the owner picker
- **`skillStats`**: like and download counters, kept separate so they don't trigger a sync
- **`skillEval`**, **`skillEvalRun`**: Skill Lab test cases and run history
- **`skillRelation`**, **`skillQuality`**: overlap-check results
- **`proseTestSession`**, **`proseVote`**: Prose Pick A/B tests

## Tools

- **Skills Explorer**: browse, ZIP download, install commands, and a "Try" chat playground
- **Skill Lab**: run evals against test cases and compare models (Claude / GPT / Gemini)
- **Prose Pick**: A/B-test prose across model and skill conditions
- **Structure**: skills by audience, tag and owner, plus People, Audiences and eval data

## Scripts

Run with `npx sanity exec scripts/<name>.ts --with-user-token`. Most scripts dry-run by default; set `APPLY=1` to write.

| Script | What it does |
|---|---|
| `seed.ts` | Creates the Everyone audience and an example skill |
| `import-people.ts` | Loads People from a CSV |
| `import-skill-from-repo.ts` | Imports a skill that arrived by PR into the Studio |
| `resync-all-skills.ts` | Re-renders every skill to GitHub in one commit (`GH_TOKEN`) |
| `check-overlap.ts` | Runs the overlap check for one skill (`SKILL`, `OPENROUTER_API_KEY`) |
| `run-selection-eval.ts` | Runs selection evals from the terminal |

## Tests

```bash
pnpm exec vitest run
```
