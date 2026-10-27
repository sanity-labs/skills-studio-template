import { useEffect, useMemo, useState } from "react";
import { useClient, useDocumentStore } from "sanity";
import { useObservable } from "react-rx";
import { defineQuery } from "groq";
import { getPublishedId, getVersionFromId } from "../../utils/documentIds";

/**
 * Which skills have unpublished work sitting in a content release.
 *
 * The explorer itself shows published skills only — that is what
 * `npx skills add` installs — so without this a release is invisible here:
 * someone can be rewriting a skill in a release for a week and the explorer
 * looks unchanged. This is the awareness half: the cards stay published, and
 * the tool says what is queued and where.
 *
 * Two queries, because they need different things:
 *
 * - The version documents come from `listenQuery` on the `raw` perspective,
 *   which is the one place raw is the right answer: we are asking *about* the
 *   stored copies rather than reading content through a perspective. It stays
 *   live, so adding a skill to a release updates the notice.
 * - The release titles need `releases::all()`, which requires API version
 *   2025-02-19, so they come from an explicit client. They are fetched once per
 *   set of release IDs seen, and a release that isn't active or scheduled
 *   (archived, already published) is dropped — its leftover version documents
 *   are not pending work.
 *
 * Fail-soft like the other banners in this Studio: if the release fetch fails,
 * the hook reports nothing rather than blocking the tool.
 */

const SKILL_VERSIONS_QUERY = defineQuery(`*[_type == "skill" && _id in path("versions.**")]{
  _id,
  skillName,
  "unpublish": _system.delete == true
}`);

// Not a `defineQuery`: `releases::all()` is a system function TypeGen has no
// schema for, and the shape is asserted below instead.
const ACTIVE_RELEASES_QUERY = `releases::all()[state in ["active", "scheduled"]]{
  name,
  state,
  "title": metadata.title
}`;

const RELEASES_API_VERSION = "2025-02-19";

// `raw` on purpose — see the note above. Module-level so the subscription is
// not torn down on every render.
const RAW = { perspective: "raw" } as const;

type SkillVersion = {
  _id: string;
  skillName: string | null;
  unpublish: boolean | null;
};

export type PendingSkill = {
  publishedId: string;
  skillName: string | null;
  /** Queued for unpublishing when the release ships, not for editing. */
  unpublish: boolean;
};

export type PendingRelease = {
  releaseId: string;
  title: string;
  skills: PendingSkill[];
};

export type SkillReleases = {
  /** One entry per release that holds at least one skill version. */
  releases: PendingRelease[];
  /** Releases holding a version of a given published skill ID. */
  bySkillId: Record<string, PendingRelease[]>;
  /** Distinct skills with pending work, across all releases. */
  skillCount: number;
};

const EMPTY: SkillReleases = { releases: [], bySkillId: {}, skillCount: 0 };

export function useSkillReleases(): SkillReleases {
  const documentStore = useDocumentStore();
  const client = useClient({ apiVersion: RELEASES_API_VERSION });

  const versions$ = useMemo(
    () => documentStore.listenQuery(SKILL_VERSIONS_QUERY, {}, RAW),
    [documentStore],
  );
  const versions = useObservable(versions$, null) as SkillVersion[] | null;

  // The release IDs the version documents name, as a stable primitive so the
  // metadata fetch runs when the set changes rather than on every emit.
  const releaseIdsKey = useMemo(() => {
    if (!versions) return "";
    const ids = new Set<string>();
    for (const version of versions) {
      const releaseId = getVersionFromId(version._id);
      if (releaseId) ids.add(releaseId);
    }
    return [...ids].sort().join(",");
  }, [versions]);

  const [titles, setTitles] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!releaseIdsKey) {
      setTitles({});
      return;
    }
    let cancelled = false;
    client
      .fetch<Array<{ name: string; state: string; title: string | null }>>(
        ACTIVE_RELEASES_QUERY,
        {},
        { perspective: "raw" },
      )
      .then((releases) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const release of releases ?? []) {
          if (release?.name) next[release.name] = release.title || release.name;
        }
        setTitles(next);
      })
      .catch((err) => {
        // Releases unreadable (permissions, API version) — say nothing rather
        // than half-report.
        console.warn("useSkillReleases: could not read releases", err);
        if (!cancelled) setTitles({});
      });
    return () => {
      cancelled = true;
    };
  }, [client, releaseIdsKey]);

  return useMemo(() => {
    if (!versions || !titles) return EMPTY;

    const byRelease = new Map<string, PendingRelease>();

    for (const version of versions) {
      const releaseId = getVersionFromId(version._id);
      // A version whose release is no longer active or scheduled is leftover,
      // not pending.
      if (!releaseId || !titles[releaseId]) continue;

      const entry = byRelease.get(releaseId) ?? {
        releaseId,
        title: titles[releaseId],
        skills: [],
      };
      entry.skills.push({
        publishedId: getPublishedId(version._id),
        skillName: version.skillName,
        unpublish: version.unpublish === true,
      });
      byRelease.set(releaseId, entry);
    }

    if (byRelease.size === 0) return EMPTY;

    const releases = [...byRelease.values()]
      .map((release) => ({
        ...release,
        skills: [...release.skills].sort((a, b) =>
          (a.skillName || "").localeCompare(b.skillName || ""),
        ),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    const bySkillId: Record<string, PendingRelease[]> = {};
    for (const release of releases) {
      for (const skill of release.skills) {
        bySkillId[skill.publishedId] = [
          ...(bySkillId[skill.publishedId] ?? []),
          release,
        ];
      }
    }

    return {
      releases,
      bySkillId,
      skillCount: Object.keys(bySkillId).length,
    };
  }, [versions, titles]);
}
