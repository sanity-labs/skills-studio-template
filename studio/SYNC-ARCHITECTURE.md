# Skills Studio → GitHub Sync Architecture

## Overview

When a skill or skill reference is published in the Skills Studio, it automatically syncs to the GitHub repository configured in `studio/skills.config.ts`. This happens through two mechanisms:

1. **Sanity Function** (`publish-to-github`) — Triggers automatically on publish events
2. **Document Action** (`publishToGitHub.tsx`) — Manual "Sync to GitHub" button in the Studio UI

Both use the GitHub Git Trees API to make atomic multi-file commits.

## Repository Structure

Since the audience split, **one plugin folder per audience**. Every `audience`
document in the dataset maps to a folder (`pluginName ?? slug`); a skill is
published into each folder matching its `audiences` references. The Everyone
audience overrides `pluginName` to `everyonePluginName` from
`studio/skills.config.ts` (default `org-skills`).

```
<owner>/<repo>/
├── org-skills/                 ← Everyone plugin (auto-install candidate)
│   ├── .claude-plugin/plugin.json
│   ├── .codex-plugin/plugin.json
│   └── skills/<skillName>/{SKILL.md, references/}
├── engineering/                ← Audience plugins (opt-in), same layout
├── sales/
├── skills → org-skills/skills                 ← Convenience alias (npx skills add target)
├── .agents/skills → org-skills/skills         ← Cross-harness skills path (OpenCode/Pi/Codex fallback)
├── .agents/plugins/marketplace.json               ← Codex marketplace (different schema)
├── studio/                     ← Studio source code + functions
├── .claude-plugin/
│   └── marketplace.json        ← Claude / Cursor / Copilot marketplace (shared schema)
├── .cursor-plugin/
│   └── marketplace.json
└── .github/plugin/
    └── marketplace.json
```

Routing, manifest generation, and stale-copy cleanup live in
`studio/utils/audiences.ts`, shared by both Functions and the document action.
The sync only manages `SKILL.md` and flat `references/*` inside a skill folder —
extra files (evals/, scripts/, authoring logs) and repo-native skills
(structures the schema can't model) are never touched.

**Audience changes move skills between plugins**: on the next sync, the skill
is written into its new folders and its managed files are deleted from folders
it left. Marketplace manifests and per-plugin `plugin.json` files regenerate
from the audience documents on every sync (only audiences with ≥1 published
skill are listed). Plugin versions are intentionally omitted — every git commit
counts as a new version.

**One audience set per sync.** File routing and manifest generation used to
resolve audiences independently — routing off the skill's `audiences`
references, manifests off `ALL_AUDIENCES_QUERY` — so a skill could be written
into a folder that the manifests didn't know about: a plugin folder with no
`plugin.json`, no marketplace entry and no overview skill, uninstallable and
silent. `resolveSyncAudiences` in `studio/utils/audiences.ts` now derives the
manifest/overview set from the audiences actually being routed into, so the
two cannot drift: an audience the sync writes into is always in the manifests,
and an audience that can't be resolved to a plugin (no published audience
document, or no folder name) throws before anything is committed, naming the
skill and the audience.

## Critical: Symlinks and the Git Trees API

Two repo-root symlinks point into the Everyone plugin's `skills/`:

- `skills/` — convenience alias for `npx skills add` and local browsing
- `.agents/skills/` — the de facto cross-harness fallback path. Codex, OpenCode, and Pi all scan `.agents/skills/` for `SKILL.md` files. Existing as a symlink exposes the org-wide skills via that path without duplicating content.

Both work for local filesystem access (every harness follows symlinks), but **the Git Trees API does NOT follow symlinks**. It operates directly on git objects.

If you write to `skills/foo/SKILL.md` or `.agents/skills/foo/SKILL.md` via the Trees API, Git will try to create a real directory, which conflicts with the existing symlink object. This causes a `GitRPC::BadObjectState` error.

**Always write to real plugin-folder paths** (`<pluginFolder>/skills/…` via `studio/utils/audiences.ts`); never construct paths through the symlinks. If you write any new code that touches the Trees API, route it through `computeSkillTreeChanges`.

## How the Sync Works

### Automatic (Sanity Function)

1. A `skill` or `skillReference` document is published (audience changes count — `audiences` is in the delta filter)
2. The delta GROQ filter in `function.ts` matches the change
3. The handler in `index.ts`:
   a. Fetches the full skill with dereferenced references and audiences (skills without audiences record `lastSyncError` and skip)
   b. Assembles files (SKILL.md + reference files) via `assemble.ts` and routes them into every matching plugin folder via `computeSkillTreeChanges`, including deletions of managed files from folders the skill left
   c. Regenerates marketplace.json files for all platforms plus per-plugin plugin.json from the audience documents
   d. Creates tree (inline content + sha:null deletions) → commit → updates HEAD via Git Trees API
   e. Patches the skill document with `lastPublishedAt` and `lastPublishedCommit`

### Manual (Document Action)

The "Sync to GitHub" / "Re-sync to GitHub" button in the Studio UI does the same thing but:
- Uses a per-user GitHub PAT stored via `@sanity/studio-secrets`
- Only syncs the current skill (manifests regenerate as part of every sync)
- Shows success/error dialogs in the UI

## Preventing Future Breakage

1. **Never write to `skills/` directly** — Always use `SKILLS_BASE_PATH` from `studio/utils/constants.ts`
2. **If the repo structure changes**, update `SKILLS_BASE_PATH` in one place
3. **The symlink is for convenience only** — It should never be relied upon by automated tooling
4. **Test after repo restructuring** — Any change to directory structure should be followed by a test publish from the Studio
5. **The GITHUB_TOKEN** for the Sanity Function is set in the Functions environment (not the Studio UI). The document action uses a per-user PAT from Studio Secrets.

## Marketplace Files

The function refreshes four marketplace.json files on every publish:
- `.claude-plugin/marketplace.json` (Claude Code)
- `.cursor-plugin/marketplace.json` (Cursor 2.5)
- `.github/plugin/marketplace.json` (GitHub Copilot CLI / VS Code)
- `.agents/plugins/marketplace.json` (OpenAI Codex)

The first three share an identical schema. Codex has its own (`interface.displayName`, `policy.installation`, `policy.authentication`, `category`, and an object-shaped `source` instead of a bare string). Codex *also* falls back to `.claude-plugin/marketplace.json` for backward compatibility — both paths work.

None of the manifests enumerate skills. Claude, Cursor, and Copilot auto-discover `SKILL.md` under `<plugin-source>/skills/`. Codex picks them up via the per-plugin `.codex-plugin/plugin.json`'s `"skills": "./skills/"` field. The per-skill list used to be hand-maintained in marketplace.json and went stale the moment a skill was added or renamed; we no longer maintain it.

Since manifest content is now static, the regeneration is effectively a re-stamp — it only changes the commit if the manifest itself ever changes.
