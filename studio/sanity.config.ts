import { defineConfig, createAuthStore } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { markdownSchema } from "sanity-plugin-markdown";
import { PackageIcon, PlayIcon, ClipboardIcon, SplitVerticalIcon } from "@sanity/icons";
import { schemaTypes } from "./schemaTypes";
import { structure, defaultDocumentNode } from "./structure";
import { PublishToGitHubAction } from "./actions/publishToGitHub";
import { ImproveDescriptionAction } from "./actions/improveDescription";
import { TestSkillAction } from "./actions/testSkill";
import { GeneratePairsAction } from "./actions/generatePairs";
import { MarkReviewedAction } from "./actions/markReviewed";
import { CheckOverlapAction } from "./actions/checkOverlap";
import { ReviewOverdueBadge } from "./components/reviewStatus";
import { SkillExplorerTool } from "./tools/skillExplorer";
import { EvalRunnerTool } from "./tools/evalRunner";
import { ProsePickTool } from "./tools/prosePick";
import { skillsConfig } from "./skills.config";

const { projectId, dataset } = skillsConfig.sanity;

// Optional SAML SSO: set auth.samlLoginUrl in skills.config.ts. Without it
// the Studio uses Sanity's standard login providers.
const auth = skillsConfig.auth.samlLoginUrl
  ? createAuthStore({
      projectId,
      dataset,
      mode: "replace",
      providers: [
        { name: "saml", title: "SSO", url: skillsConfig.auth.samlLoginUrl },
      ],
      loginMethod: "dual",
    })
  : undefined;

export default defineConfig({
  title: `${skillsConfig.orgName} Skills Studio`,
  projectId,
  dataset,
  ...(auth ? { auth } : {}),
  plugins: [
    structureTool({ structure, defaultDocumentNode }),
    visionTool(),
    markdownSchema(),
  ],
  schema: {
    types: schemaTypes,
  },
  document: {
    actions: (prev, context) => {
      if (context.schemaType === "skill") {
        const mapped = [...prev];
        // Insert Force Sync right after the publish action so it's
        // prominent in the action bar (not buried in overflow).
        // When there's no draft the publish action returns null,
        // so Force Sync becomes the first visible action.
        const publishIndex = mapped.findIndex(
          (a) => a.action === "publish",
        );
        const insertAt = publishIndex >= 0 ? publishIndex + 1 : 0;
        mapped.splice(insertAt, 0, PublishToGitHubAction);
        mapped.push(ImproveDescriptionAction);
        mapped.push(TestSkillAction);
        mapped.push(CheckOverlapAction);
        mapped.push(MarkReviewedAction);
        return mapped;
      }
      if (context.schemaType === "proseTestSession") {
        // Generate-pairs runs each prompt through each condition's
        // (model + skill stack) setup and populates pairs[] on the
        // draft. Surfaced as a primary action so authors can iterate
        // on prompts then regenerate quickly.
        return [...prev, GeneratePairsAction];
      }
      return prev;
    },
    badges: (prev, context) => {
      if (context.schemaType === "skill") {
        return [...prev, ReviewOverdueBadge];
      }
      return prev;
    },
  },
  tools: (prev) => [
    {
      name: "skills",
      title: "Skills Explorer",
      icon: PackageIcon,
      component: SkillExplorerTool,
    },
    {
      name: "eval-runner",
      title: "Skill Lab",
      icon: ClipboardIcon,
      component: EvalRunnerTool,
    },
    {
      name: "prose-pick",
      title: "Prose Pick",
      icon: SplitVerticalIcon,
      component: ProsePickTool,
    },
    ...prev,
  ],
});
