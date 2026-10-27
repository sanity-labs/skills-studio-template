/**
 * Marketplace manifests for Claude Code (.claude-plugin/), Cursor 2.5
 * (.cursor-plugin/), GitHub Copilot CLI / VS Code (.github/plugin/),
 * and OpenAI Codex CLI (.agents/plugins/).
 *
 * Since the audience → plugin split, manifests are generated from the
 * `audience` documents in the dataset (one plugin per audience with
 * published skills) instead of a static single-plugin literal. The shared
 * generation logic lives in studio/utils/audiences.ts — this module re-exports
 * it so the Functions build target keeps a stable import path.
 *
 * Per-platform docs:
 *  - https://code.claude.com/docs/en/plugin-marketplaces
 *  - https://github.com/cursor/plugins
 *  - github/awesome-copilot AGENTS.md
 *  - https://developers.openai.com/codex/plugins/build
 */
export {
  generateMarketplaceFiles,
  generateOverviewSkills,
  pluginFolder,
  computeSkillTreeChanges,
  resolveSyncAudiences,
  ALL_AUDIENCES_QUERY,
  AUDIENCES_PROJECTION,
  SKILL_INDEX_QUERY,
  type Audience,
  type SkillIndexEntry,
} from '../../utils/audiences'
