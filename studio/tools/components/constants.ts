import { getPublishedId } from "../../utils/documentIds";

export { REPO_URL } from "../../utils/constants";

export type SortOption = "updated" | "downloads" | "likes" | "name";

export const SORT_OPTIONS: { value: SortOption; title: string }[] = [
  { value: "updated", title: "Recently Updated" },
  { value: "downloads", title: "Most Downloaded" },
  { value: "likes", title: "Most Liked" },
  { value: "name", title: "Name A-Z" },
];

export interface SkillStatsMap {
  [skillId: string]: { downloads: number; likes: number };
}

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// Downloads and likes belong to the skill, not to one copy of it: a stats doc
// keyed by a `drafts.`/`versions.` ID would fork the counters per release and
// leave the numbers behind when the release publishes. Both helpers normalize.
export function getStatsDocId(skillId: string) {
  return `stats-${getPublishedId(skillId)}`;
}

export function isLikedInStorage(skillId: string): boolean {
  try {
    return localStorage.getItem(likeStorageKey(skillId)) === "true";
  } catch {
    return false;
  }
}

export function setLikedInStorage(skillId: string, liked: boolean) {
  try {
    if (liked) {
      localStorage.setItem(likeStorageKey(skillId), "true");
    } else {
      localStorage.removeItem(likeStorageKey(skillId));
    }
  } catch {
    // Private mode / blocked storage — the like still hits the dataset
  }
}

function likeStorageKey(skillId: string) {
  return `skill-like-${getPublishedId(skillId)}`;
}
