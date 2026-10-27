# AGENTS.md

You're an AI agent working in a **Skills Studio** repo: an org's AI agent skills, authored in a Sanity Studio and published here as a plugin marketplace. This file is the orientation cheat sheet. Org-specific values (project ID, repo, marketplace and plugin names) live in `studio/skills.config.ts`. Read it rather than guessing.

## What this repo is

A **plugin marketplace** that distributes AI agent skills across Claude Code, Cursor, GitHub Copilot and OpenAI Codex. Skills are grouped into one plugin per **audience**. They are authored in the Sanity Studio in `studio/` and synced to GitHub by a Sanity Function on every publish, so most files under `<plugin>/skills/` are generated, not hand-written.

## Repo layout

```
studio/skills.config.ts                  Org-specific configuration (single source)
.claude-plugin/marketplace.json          Claude Code marketplace        (generated)
.cursor-plugin/marketplace.json          Cursor 2.5 marketplace         (generated)
.github/plugin/marketplace.json          GitHub Copilot marketplace     (generated)
.agents/plugins/marketplace.json         OpenAI Codex marketplace       (generated)
.agents/skills → <everyone-plugin>/skills   Cross-harness skills path symlink
skills → <everyone-plugin>/skills           Convenience symlink
<plugin>/                                One folder per audience (generated)
├── .claude-plugin/plugin.json           Plugin manifest (Claude / Copilot fallback)
├── .codex-plugin/plugin.json            Plugin manifest (Codex; declares "skills": "./skills/")
└── skills/<name>/SKILL.md               Each skill (auto-discovered by all 4 harnesses)
sanity.blueprint.ts                      Functions stack (root, next to pnpm-lock.yaml)
functions/                               publish-to-github, delete-from-github (import studio/utils)
studio/                                  Sanity Studio source (TypeScript)
automation/                              Optional org-scoped scheduled Functions
scripts/setup.mjs                        First-run setup that writes skills.config.ts
```

## What you should NOT edit by hand

- **Marketplace and plugin JSON files.** The publish and delete Functions regenerate them on every sync. Change `studio/utils/audiences.ts` instead.
- **Skill bodies under `<plugin>/skills/<name>/SKILL.md`.** They are rendered from Sanity documents, and the next Studio publish overwrites direct edits. Make content changes in the Studio.
- **The two symlinks** (`skills` and `.agents/skills`). Filesystem walks follow them; the Git Trees API does not. Write to `<plugin>/skills/<name>/`, never through a symlink, or GitHub throws `GitRPC::BadObjectState`.

## Adding or modifying skills

**Preferred:** the Studio. The Studio is the source of truth; GitHub holds the published copy.

**Direct edits in a PR** are fine for small fixes. Port the fix into the Studio document too, or the next publish overwrites it.

**New skills in a PR** are imported into the Studio after merge with `studio/scripts/import-skill-from-repo.ts` (see `CONTRIBUTING.md`).

### Required SKILL.md frontmatter

```yaml
---
name: skill-slug
description: >
  One paragraph. When to load this skill. Trigger phrases. What it does
  and explicitly does not do.
---
```

`name` must be lowercase `a-z0-9-` and match the parent directory. `description` is hard-capped at 1024 characters.

### Optional metadata

```yaml
version: 2026-01-15
tags:
  - process
visibility: shareable        # or confidential
owner: Ada Lovelace <ada@example.com>
```

### Invocation (Claude Code only)

Set in the Studio's **Invocation** section and emitted only when it isn't the default:

```yaml
disable-model-invocation: true   # "Only people": run with /skill-name, never auto-loaded
user-invocable: false            # "Only Claude": hidden from the / menu
argument-hint: "[ticket-url]"    # autocomplete hint after /skill-name
```

### Reference files

Heavier supporting docs go in a flat `references/` directory next to `SKILL.md`. Filenames must match `^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z]+)?$`; the sync adds `.md` if the extension is missing. The sync manages only `SKILL.md` and `references/*`, so other files in a skill folder (`evals/`, `scripts/`) survive republishing.

## Working on the Studio or Functions code

Install from the repo root (a pnpm workspace of `studio/` and `functions/`); `pnpm test` at the root runs both test suites. Deploy Functions from the root, never from `studio/`. Studio commands run from `studio/`:

```bash
pnpm install                      # at the repo root
cd studio
pnpm typegen                      # regenerate sanity.types.ts after schema/GROQ edits
pnpm exec vitest run              # tests
pnpm exec tsc --noEmit            # type-check (a few known errors, see below)
pnpm build                        # build the Studio
```

Things to know:

- **Known `tsc` errors:** `actions/improveDescription.tsx` and `actions/testSkill.tsx` (`userMessage` on Agent Actions), `components/GitHubSyncBanner.tsx` (`useObservable` overload), and `sanity.config.ts` (`mode` on `createAuthStore`). Scripts also lack `@types/node`. None of these block builds.
- **`useToast`** comes from `@sanity/ui`, NOT from `sanity`. The wrong import compiles but breaks the deploy build.
- **`client.action()` for document edits** requires `apiVersion: 'vX'` (use a `vX` client); otherwise you get a 404 at runtime.
- Read `studio/CLAUDE.md` before touching anything that handles document IDs or perspectives. Content Releases make every document exist in up to three copies.

## Functions runtime caveat

After committing to GitHub, the publish-to-github Function writes back to the skill document (`lastPublishedAt`, `lastPublishedCommit`). The runtime's injected `context.clientOptions` is **read-scoped**, so these writes need an explicit `SANITY_WRITE_TOKEN` env var. Without it, the commit succeeds but the Studio shows "not synced". The Function records this in `lastSyncError` so the banner can tell the two cases apart.

## Sync verification

When debugging a sync issue, check BOTH sides before proposing a fix:

- **GitHub:** `git log --oneline <plugin>/skills/<name>/`. Did the commit happen?
- **Sanity:** the skill document's `lastPublishedCommit` and `lastSyncError`. Did the writeback happen?

Three failure modes look identical in the Studio UI, and each has a different fix:

1. The Function never fired. The event filter excluded the doc, or the runtime crashed before calling GitHub.
2. The GitHub commit failed (auth, repo state, bad data shape).
3. The commit succeeded but the Sanity writeback failed (read-scoped token).

## References

- Configuration: `studio/skills.config.ts`
- Sync mechanics: `studio/SYNC-ARCHITECTURE.md`
- Contributing a skill: `CONTRIBUTING.md`
- Domain vocabulary: `CONTEXT.md`
