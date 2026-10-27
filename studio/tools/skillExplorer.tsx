import { useMemo, useState, useCallback, useEffect } from "react";
import { useDocumentStore, useClient } from "sanity";
import { useObservable } from "react-rx";
import { defineQuery } from "groq";
import { Box, Card, Flex, Spinner, useToast } from "@sanity/ui";
import type { Skill } from "../types";

/** One dereferenced audience on a skill, as SKILLS_QUERY projects it. */
type SkillAudience = NonNullable<Skill["audiences"]>[number];
import { generateSkillZip, triggerDownload } from "../utils/generateSkillZip";
import { REPO_OWNER, REPO_NAME } from "../utils/constants";
import {
  getStatsDocId,
  isLikedInStorage,
  setLikedInStorage,
} from "./components/constants";
import type { SortOption, SkillStatsMap } from "./components/constants";
import type { AudienceOption } from "./components/FilterBar";
import { ExplorerHeader } from "./components/ExplorerHeader";
import { InstallationGuide } from "./components/InstallationGuide";
import { FortuneQuote } from "./components/FortuneQuote";
import { ChatPlayground } from "./components/ChatPlayground";
import { PendingReleasesNotice } from "./components/PendingReleasesNotice";
import { useSkillReleases } from "./components/useSkillReleases";
import { SkillsBrowser } from "./components/SkillsBrowser";
import { useChatPlayground } from "./components/useChatPlayground";

// The explorer is the published catalogue: these queries run on the
// `published` perspective, so what a card shows is what `npx skills add`
// installs. That also means no `drafts.**` / `versions.**` filtering is
// needed — the perspective returns one document per skill, and a skill being
// edited in a content release surfaces through `useSkillReleases` instead of
// replacing what is live.
const SKILLS_QUERY = defineQuery(`*[_type == "skill"] | order(skillName asc) {
  _id,
  skillName,
  title,
  description,
  content,
  lastPublishedAt,
  _updatedAt,
  "referenceCount": count(references),
  references[]->{filename, content},
  "audiences": audiences[]->{_id, title, "slug": slug.current, pluginName, autoInstall},
  "metadata": metadata { visibility, tags, owner, owners, lastReviewedAt, reviewEveryDays },
  invocation
}`);

const STATS_QUERY = defineQuery(`*[_type == "skillStats"] { _id, skillId, downloads, likes }`);

// Module-level so the subscriptions aren't rebuilt on every render.
const PUBLISHED_ONLY = {perspective: "published"} as const;

const INITIAL_SKILLS: Skill[] | null = null;
const INITIAL_STATS: Array<{
  _id: string;
  skillId: string;
  downloads: number;
  likes: number;
}> | null = null;

export function SkillExplorerTool() {
  const documentStore = useDocumentStore();
  const client = useClient({ apiVersion: "2024-01-01" });
  const skillReleases = useSkillReleases();
  const toast = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [likedSkills, setLikedSkills] = useState<Record<string, boolean>>({});
  // Optimistic overrides — cleared when server catches up
  const [optimistic, setOptimistic] = useState<
    Record<string, { downloads?: number; likes?: number }>
  >({});

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>("updated");
  const [searchQuery, setSearchQuery] = useState("");

  const skills$ = useMemo(
    () => documentStore.listenQuery(SKILLS_QUERY, {}, PUBLISHED_ONLY),
    [documentStore],
  );
  const skills = useObservable(skills$, INITIAL_SKILLS);

  const stats$ = useMemo(
    () => documentStore.listenQuery(STATS_QUERY, {}, PUBLISHED_ONLY),
    [documentStore],
  );
  const rawStats = useObservable(stats$, INITIAL_STATS);

  const statsMap = useMemo<SkillStatsMap>(() => {
    if (!rawStats) return {};
    const map: SkillStatsMap = {};
    for (const s of rawStats) {
      if (s.skillId) {
        map[s.skillId] = { downloads: s.downloads || 0, likes: s.likes || 0 };
      }
    }
    return map;
  }, [rawStats]);

  // Compute displayed stats: optimistic override takes precedence over server
  const getDisplayStats = useCallback(
    (skillId: string) => {
      const server = statsMap[skillId] || { downloads: 0, likes: 0 };
      const opt = optimistic[skillId];
      return {
        downloads: Math.max(0, opt?.downloads ?? server.downloads),
        likes: Math.max(0, opt?.likes ?? server.likes),
      };
    },
    [statsMap, optimistic],
  );

  const filteredSkills = useMemo(() => {
    if (!skills) return null;
    let result = [...skills];

    // Tag filter (show skills matching ANY selected tag)
    if (selectedTags.length > 0) {
      result = result.filter((s) =>
        s.metadata?.tags?.some((t: string) => selectedTags.includes(t)),
      );
    }

    // Audience filter — an audience is the plugin a skill ships in, so this
    // answers "what does someone in Sales actually get installed?"
    if (selectedAudiences.length > 0) {
      result = result.filter((s) =>
        (s.audiences ?? []).some((a: SkillAudience) =>
          selectedAudiences.includes(a._id),
        ),
      );
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.skillName.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q),
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "updated":
          return (
            new Date(b._updatedAt).getTime() - new Date(a._updatedAt).getTime()
          );
        case "downloads":
          return (
            getDisplayStats(b._id).downloads - getDisplayStats(a._id).downloads
          );
        case "likes":
          return getDisplayStats(b._id).likes - getDisplayStats(a._id).likes;
        case "name":
          return a.skillName.localeCompare(b.skillName);
      }
    });

    return result;
  }, [
    skills,
    selectedTags,
    selectedAudiences,
    sortBy,
    searchQuery,
    getDisplayStats,
  ]);

  const availableTags = useMemo(() => {
    if (!skills) return [];
    const tags = new Set<string>();
    for (const s of skills) {
      for (const t of s.metadata?.tags ?? []) tags.add(t);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [skills]);

  const availableAudiences = useMemo(() => {
    if (!skills) return [];
    const byId = new Map<string, AudienceOption>();
    for (const s of skills) {
      for (const a of (s.audiences ?? []) as SkillAudience[]) {
        if (a?._id && !byId.has(a._id)) {
          byId.set(a._id, {
            _id: a._id,
            title: a.title || a.slug || a._id,
            autoInstall: a.autoInstall === true,
          });
        }
      }
    }
    // Auto-installed plugins first — that's the set everyone already has.
    return [...byId.values()].sort((a, b) =>
      a.autoInstall === b.autoInstall
        ? a.title.localeCompare(b.title)
        : a.autoInstall
          ? -1
          : 1,
    );
  }, [skills]);

  const handleToggleAudience = useCallback((audienceId: string) => {
    setSelectedAudiences((prev) =>
      prev.includes(audienceId)
        ? prev.filter((a) => a !== audienceId)
        : [...prev, audienceId],
    );
  }, []);

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(event.currentTarget.value);
    },
    [],
  );

  // Clear optimistic values when server catches up
  useEffect(() => {
    setOptimistic((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [skillId, opt] of Object.entries(next)) {
        const server = statsMap[skillId];
        if (!server) continue;
        let clear = true;
        if (opt.downloads !== undefined && server.downloads < opt.downloads)
          clear = false;
        if (opt.likes !== undefined && server.likes < opt.likes) clear = false;
        if (clear) {
          delete next[skillId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [statsMap]);

  // Initialize liked state from localStorage once skills load
  useEffect(() => {
    if (!skills) return;
    const liked: Record<string, boolean> = {};
    for (const skill of skills) {
      if (isLikedInStorage(skill._id)) {
        liked[skill._id] = true;
      }
    }
    setLikedSkills(liked);
  }, [skills]);

  const incrementDownloadCount = useCallback(
    (skillId: string) => {
      const docId = getStatsDocId(skillId);
      client
        .createIfNotExists({
          _id: docId,
          _type: "skillStats",
          skillId,
          downloads: 0,
          likes: 0,
        })
        .then(() => client.patch(docId).inc({ downloads: 1 }).commit())
        .catch(() => {
          // Fire-and-forget: silently ignore counter errors
        });
    },
    [client],
  );

  const handleToggleLike = useCallback(
    (skillId: string) => {
      const docId = getStatsDocId(skillId);
      const currentlyLiked = likedSkills[skillId] || false;

      // Immediately set optimistic count
      const currentDisplay = getDisplayStats(skillId);
      setOptimistic((prev) => ({
        ...prev,
        [skillId]: {
          ...prev[skillId],
          likes: Math.max(
            0,
            currentlyLiked
              ? currentDisplay.likes - 1
              : currentDisplay.likes + 1,
          ),
        },
      }));

      if (currentlyLiked) {
        // Unlike
        setLikedSkills((prev) => {
          const next = { ...prev };
          delete next[skillId];
          return next;
        });
        setLikedInStorage(skillId, false);
        client
          .createIfNotExists({
            _id: docId,
            _type: "skillStats",
            skillId,
            downloads: 0,
            likes: 0,
          })
          .then(() => client.patch(docId).dec({ likes: 1 }).commit())
          .catch(() => {});
      } else {
        // Like
        setLikedSkills((prev) => ({ ...prev, [skillId]: true }));
        setLikedInStorage(skillId, true);
        client
          .createIfNotExists({
            _id: docId,
            _type: "skillStats",
            skillId,
            downloads: 0,
            likes: 0,
          })
          .then(() => client.patch(docId).inc({ likes: 1 }).commit())
          .catch(() => {});
      }
    },
    [client, likedSkills, getDisplayStats],
  );

  const handleDownloadSkill = useCallback(
    async (skill: Skill) => {
      setDownloading(skill._id);
      try {
        const blob = await generateSkillZip(skill);
        triggerDownload(blob, `${skill.skillName}.zip`);
        toast.push({
          status: "success",
          title: `Downloaded ${skill.skillName}.zip`,
        });
        // Immediately set optimistic count
        const currentDisplay = getDisplayStats(skill._id);
        setOptimistic((prev) => ({
          ...prev,
          [skill._id]: {
            ...prev[skill._id],
            downloads: currentDisplay.downloads + 1,
          },
        }));
        // Fire-and-forget: increment download counter
        incrementDownloadCount(skill._id);
      } catch (err: unknown) {
        toast.push({
          status: "error",
          title: "Download failed",
          description: err instanceof Error ? err.message : String(err),
        });
      }
      setDownloading(null);
    },
    [toast, incrementDownloadCount, getDisplayStats],
  );

  const handleDownloadAll = useCallback(async () => {
    if (!skills) return;
    setDownloading("all");
    let downloadedCount = 0;
    for (const skill of skills) {
      try {
        const blob = await generateSkillZip(skill);
        triggerDownload(blob, `${skill.skillName}.zip`);
        downloadedCount++;
        // Optimistic count
        setOptimistic((prev) => ({
          ...prev,
          [skill._id]: {
            ...prev[skill._id],
            downloads: getDisplayStats(skill._id).downloads + 1,
          },
        }));
        incrementDownloadCount(skill._id);
        // Small delay between downloads to prevent browser throttling
        if (downloadedCount < skills.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch {
        // Continue with remaining skills
      }
    }
    toast.push({
      status: "success",
      title: `Downloaded ${downloadedCount} of ${skills.length} skill ZIPs`,
    });
    setDownloading(null);
  }, [skills, toast, incrementDownloadCount, getDisplayStats]);

  const handleCopyInstallCommand = useCallback(
    (skillName: string) => {
      const command = `npx skills add git@github.com:${REPO_OWNER}/${REPO_NAME}.git --skill ${skillName}`;
      navigator.clipboard.writeText(command).then(() => {
        toast.push({
          status: "success",
          title: `Copied install command for "${skillName}"`,
        });
      });
    },
    [toast],
  );

  const chat = useChatPlayground({ skills, client });

  if (skills === null) {
    return (
      <Card padding={5}>
        <Flex justify="center" align="center" style={{ minHeight: "50vh" }}>
          <Spinner muted />
        </Flex>
      </Card>
    );
  }

  return (
    <Card padding={5} sizing="border">
      <Flex direction="column" gap={6}>
        {/* Layer 1: Header */}
        <ExplorerHeader
          downloading={downloading}
          onDownloadAll={handleDownloadAll}
        />

        {/* What's queued in content releases but not published yet */}
        <PendingReleasesNotice
          releases={skillReleases.releases}
          skillCount={skillReleases.skillCount}
        />

        {/* Layer 2: Installation — full width (two boxes side-by-side internally) */}
        <InstallationGuide />

        {/* Layer 3: Quote or active chat — full width, between install and skills list */}
        {chat.chatSkill ? (
          <Box style={{ maxHeight: 600, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <ChatPlayground
              skill={chat.chatSkill}
              messages={chat.chatMessages}
              input={chat.chatInput}
              loading={chat.chatLoading}
              messagesRef={chat.chatMessagesRef}
              onInputChange={chat.setChatInput}
              onSendMessage={chat.handleSendMessage}
              onClear={chat.handleClearChat}
              onClose={chat.handleCloseChat}
            />
          </Box>
        ) : skills.length > 0 ? (
          <FortuneQuote skills={skills} />
        ) : null}

        {/* Layer 4: Skills browser */}
        <SkillsBrowser
          skills={skills}
          filteredSkills={filteredSkills}
          availableTags={availableTags}
          selectedTags={selectedTags}
          availableAudiences={availableAudiences}
          selectedAudiences={selectedAudiences}
          releasesBySkillId={skillReleases.bySkillId}
          sortBy={sortBy}
          searchQuery={searchQuery}
          onToggleTag={handleToggleTag}
          onToggleAudience={handleToggleAudience}
          onSortChange={setSortBy}
          onSearchChange={handleSearchChange}
          onClearFilters={() => {
            setSelectedTags([]);
            setSelectedAudiences([]);
            setSearchQuery("");
          }}
          downloading={downloading}
          likedSkills={likedSkills}
          getDisplayStats={getDisplayStats}
          onDownload={handleDownloadSkill}
          onToggleLike={handleToggleLike}
          onCopyInstallCommand={handleCopyInstallCommand}
          onTrySkill={chat.handleTrySkill}
        />
      </Flex>
    </Card>
  );
}
