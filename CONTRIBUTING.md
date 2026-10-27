# Contributing skills

Anyone in the org with Studio access can contribute: add a new skill, improve an existing one, or fix a typo.

## Overview

This repo contains AI agent skills managed in the Skills Studio (`https://<studioHost>.sanity.studio`; see `studio/skills.config.ts`). Skills are authored in the Studio and synced to this GitHub repo automatically by a Sanity Function.

## Workflow

1. **Edit skills in the Studio** — The Studio is the source of truth for skill content.
2. **Publish** — Publishing a skill triggers the Sanity Function, which commits the skill files to this repo.
3. **Re-sync if needed** — Use the "Sync to GitHub" / "Re-sync to GitHub" document action in the Studio if the automatic sync didn't fire. The sync banner on each skill shows the latest commit and any sync errors.

## Skills that arrive by pull request

A new skill opened as a PR (`<plugin>/skills/<name>/`) has no Studio document, so it misses the plugin's overview skill, overlap checks, evals and the freshness digest. Import it once the PR is reviewed:

1. **Merge the PR.** Do this first: publishing in the Studio commits the same files to `main`, and if that lands before the merge the PR conflicts.
2. **Dry run the import** and read the report:

   ```bash
   cd studio
   npx sanity exec scripts/import-skill-from-repo.ts --with-user-token -- ../<plugin>/skills/<name>
   ```

   It maps the frontmatter onto the skill fields, matches `owner` emails against the People directory, takes audiences from the plugin folders the skill sits in, and checks that a Studio publish writes the files back unchanged. It stops on anything a publish would lose (frontmatter keys with no Studio field, nested `references/` folders, a name that doesn't match the folder) and lists metadata to fill in (tags, visibility, owners).
3. **Import:** run it again with `APPLY=1`. That creates the reference files and the skill as a **draft**.
4. **Publish in the Studio.** Open the draft, fill in anything the report listed, run "Compare with other skills", and publish. From then on, edit the skill in the Studio.

For a PR that edits a skill the Studio already has, port the change into the Studio document by hand. Otherwise the next publish overwrites it.

## Schema Changes and the GitHub Sync Function

The Sanity Function that syncs skills to GitHub triggers on changes to specific fields. This is controlled by `delta::changedAny()` filters in `functions/publish-to-github/function.ts`.

**Two trigger paths:**
1. **Skill changes** — `skillName`, `description`, `content`, or `references` array changes on a `skill` document, OR a first-time publish of any `skill` document
2. **Reference changes** — `content` or `filename` changes on a `skillReference` document → the Function looks up the parent skill and syncs it. First-time publish of a reference also fires.

**Why first-time publish needs special handling:** `delta::changedAny(...)` returns false on document creation because `before()` is `null` — there's no diff baseline. We OR in `delta::operation() == 'create'` to catch the first publish. See the filter in `functions/publish-to-github/function.ts` for the canonical pattern.

This means editors don't need to re-publish the parent skill after editing a reference file.

When adding new fields to the `skill` schema, decide whether changes to that field should trigger a GitHub sync:

- **Yes (content fields):** Add the field to the `delta::changedAny()` tuple in `functions/publish-to-github/function.ts`
- **No (metadata, counters, UI state):** Leave it out of the filter. The Function will ignore changes to it.

If you skip this step, new content fields won't sync to GitHub, or new metadata fields will cause unnecessary commits.

### Current sync-triggering fields

| Document Type | Field | Why it triggers sync |
|--------------|-------|---------------------|
| `skill` | `skillName` | Determines the GitHub folder name |
| `skill` | `description` | Included in SKILL.md frontmatter |
| `skill` | `content` | The main SKILL.md body |
| `skill` | `references` | Reference files in the `references/` folder |
| `skill` | `invocation` | Claude Code invocation keys in SKILL.md frontmatter (`disable-model-invocation`, `user-invocable`, `argument-hint`); nothing is emitted for the default |
| `skillReference` | `content` | Reference file body |
| `skillReference` | `filename` | Reference file name in `references/` |

### Fields that do NOT trigger sync

| Field | Why it's excluded |
|-------|------------------|
| `lastPublishedAt` | Set by the Function itself (would cause recursion) |
| `lastPublishedCommit` | Set by the Function itself |
| `lastSyncError` | Set by the Function itself when the post-commit patch fails |

## Sync Architecture

For a detailed explanation of how the Studio → GitHub sync works, including the symlink caveat and the Git Trees API, see **[studio/SYNC-ARCHITECTURE.md](studio/SYNC-ARCHITECTURE.md)**.

Key points:
- Skills are written to `<plugin-folder>/skills/` (never through the `skills/` symlink), because the Git Trees API doesn't follow symlinks
- Plugin folders come from audience documents (`pluginName` or slug); routing lives in `studio/utils/audiences.ts`
- The Sanity Function, the document action and `scripts/resync-all-skills.ts` share that module

## Agent Plugin Marketplaces

This repo is packaged as a plugin marketplace for Claude Code, Cursor, GitHub Copilot, and OpenAI Codex. The four marketplace.json files (`.claude-plugin/`, `.cursor-plugin/`, `.github/plugin/`, `.agents/plugins/`) are **auto-generated** — both the publish and delete Sanity Functions regenerate them as part of their atomic commits. Do not edit them manually.

Claude, Cursor, and Copilot share an identical marketplace schema. Codex uses a slightly different schema (`interface.displayName`, `policy.installation`, `policy.authentication`, `category`) at `.agents/plugins/marketplace.json`. Codex also falls back to `.claude-plugin/marketplace.json` for backward compatibility.

Skills are auto-discovered from `<plugin>/skills/` for Claude/Cursor/Copilot. For Codex, each plugin's `.codex-plugin/plugin.json` declares `"skills": "./skills/"` explicitly. You don't need to add new skills to any manifest in either case.

For OpenCode, Pi, and any other agent harness, the org-wide skills are reachable via `.agents/skills/` (a symlink into the Everyone plugin's `skills/`). Users on those harnesses can run `npx skills add <owner>/<repo> --skill <name>` (the universal CLI auto-detects the harness) or clone and symlink `.agents/skills/` into their workspace.

## Skill Structure

Each skill follows this convention:

```
<plugin>/skills/<skill-name>/
├── SKILL.md          # Main instruction file with YAML frontmatter
└── references/       # Optional reference files
    ├── file1.md
    └── file2.md
```

## Studio Development

The Studio lives in `studio/`. See `studio/README.md` for setup instructions.

```bash
cd studio
pnpm install
pnpm dev
```

## Types

Types are auto-generated from the schema using [Sanity TypeGen](https://www.sanity.io/docs/sanity-typegen). During `sanity dev`, types regenerate automatically.

If you change the schema or GROQ queries, run:

```bash
pnpm typegen
```

Commit the updated `sanity.types.ts`.

## CI/CD

- **Studio deploys** automatically on push to `main` when `studio/**` changes (`.github/workflows/deploy-studio.yml`)
- **Function deploys** automatically on push to `main` when `functions/**`, `sanity.blueprint.ts`, `studio/utils/**` or `studio/skills.config.ts` changes (`.github/workflows/deploy-functions.yml`)
- Both need the `SANITY_DEPLOY_TOKEN` secret and the `SANITY_PROJECT_ID` variable; the Functions deploy also needs `SANITY_ORGANIZATION_ID` and `SANITY_BLUEPRINT_STACK_ID`. Jobs are skipped until the variables exist, so a fresh fork doesn't fail CI.
