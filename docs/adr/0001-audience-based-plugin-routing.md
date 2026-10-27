# Audience-based plugin routing

Skills are routed into plugins by **audience**, the intended consumer group, rather than by owning team or topic. Distribution is a consumer-side question ("should this be in my context?"). Teams describe producers, and topics fragment into too many tiny plugins. One plugin holding every skill would put every team's skills in everyone's context.

## Decisions

- **Seed audiences from coarse departments plus Everyone** (e.g. Engineering, Sales, Marketing, People, Finance). Keep them coarse on purpose: a broad "Sales" or "Customer-facing" audience absorbs most skills that would otherwise need several audiences.
- **A skill may have several audiences** and is published into each matching plugin. Claude namespaces duplicates (`plugin:skill`), so overlap is safe but visible. We accept that cost to keep Everyone reserved for genuinely org-wide skills.
- **The Everyone plugin's folder name is configurable** (`everyonePluginName` in `studio/skills.config.ts`). It is the plugin to install by default across the org. Pick the name once: renaming it later breaks existing installs.
- **Plugin versions are omitted from all generated manifests.** Every git commit then counts as a new version, whereas a `plugin.json` version would silently override the marketplace entry.
- **The Studio is the source of truth; repo skill folders are generated output.** The exception is skills whose structure the schema can't model (`evals/`, scripts, nested references), which stay repo-native. The publish pipeline manages only `SKILL.md` and flat `references/*` within a skill folder, so hand-maintained extras survive republishing.
- **Distribution:** in the Claude org settings, the Everyone plugin is installed by default and audience plugins are opt-in. The GitHub marketplace remains the canonical channel for Claude Code, Cursor, Copilot and Codex.

## Consequences

- When a skill leaves the Everyone plugin, it disappears from people's context until they install the audience plugin. Announce audience moves.
- The top-level `skills/` and `.agents/skills` symlinks must never be written through via the Git Trees API. A tree write replaces the symlink blob and forks content, so the publish action writes real plugin-folder paths only.
