# Skills Studio

An org's AI agent skills: authored in the Skills Studio (`studio/`, project configured in `studio/skills.config.ts`) and published as audience-scoped plugins from this repo's marketplace.

## Language

**Skill**:
A unit of agent instruction: a SKILL.md (frontmatter + body) plus optional reference files. Authored in Skills Studio.

**Reference**:
A supporting file that ships in a skill's `references/` folder. The Studio manages only flat references, with no subdirectories.

**Audience**:
The intended consumer group of a skill: the people who should have it in their agent's context. It is the routing axis for distribution. Distinct from the owning team (producer) and from topic (subject matter). Each audience maps 1:1 to a plugin.
_Avoid_: Category, team, tag

**Everyone**:
The audience for genuinely org-wide skills. Its plugin folder is `everyonePluginName` in `skills.config.ts`, and it is the plugin to set as installed-by-default in your Claude org.

**Plugin**:
The unit of installation on the consumer side: a folder in this repo listed in the marketplace manifests. Generated from an audience document.

**Publish**:
The Studio action that renders a skill into every plugin folder matching its audiences, cleans up stale copies, and regenerates the marketplace manifests.

**Repo-native skill**:
A skill maintained directly in git because the Studio schema can't model its structure (evals, scripts, nested references). It is a documented exception to the Studio being the source of truth. The sync never touches files it doesn't manage.

**Owner**:
A person responsible for keeping a skill current. Stored as a snapshot (name, email, optional slackId) picked from the People directory. Owners are pinged in the freshness digest.

**People**:
The `orgPerson` documents that back the owner picker. You maintain them in the Studio, import them from CSV, or sync them from your HRIS with a scheduled Function.

**Review cadence**:
How often a skill should be re-checked (`reviewEveryDays`, default 90). A skill is overdue when its last review (or last edit) is older than its cadence.

**Overview skill**:
The generated `<plugin>-overview` skill, a per-plugin directory of skills that is regenerated on every sync. The Everyone plugin's overview is the full cross-plugin catalog. Audience documents can append team guidance via Overview Skill Notes.
