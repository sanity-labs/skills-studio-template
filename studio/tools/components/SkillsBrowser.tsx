import { Stack, Grid } from "@sanity/ui";
import { FilterBar } from "./FilterBar";
import { SkillCard } from "./SkillCard";
import type { SortOption } from "./constants";
import type { AudienceOption } from "./FilterBar";
import type { PendingRelease } from "./useSkillReleases";
import type { Skill } from "../../types";

interface SkillsBrowserProps {
  skills: Skill[] | null;
  filteredSkills: Skill[] | null;
  availableTags: string[];
  selectedTags: string[];
  availableAudiences: AudienceOption[];
  selectedAudiences: string[];
  releasesBySkillId: Record<string, PendingRelease[]>;
  sortBy: SortOption;
  searchQuery: string;
  onToggleTag: (tag: string) => void;
  onToggleAudience: (audienceId: string) => void;
  onSortChange: (sort: SortOption) => void;
  onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearFilters: () => void;
  downloading: string | null;
  likedSkills: Record<string, boolean>;
  getDisplayStats: (skillId: string) => { downloads: number; likes: number };
  onDownload: (skill: Skill) => void;
  onToggleLike: (skillId: string) => void;
  onCopyInstallCommand: (skillName: string) => void;
  onTrySkill: (skillId: string) => void;
}

export function SkillsBrowser({
  skills,
  filteredSkills,
  availableTags,
  selectedTags,
  availableAudiences,
  selectedAudiences,
  releasesBySkillId,
  sortBy,
  searchQuery,
  onToggleTag,
  onToggleAudience,
  onSortChange,
  onSearchChange,
  onClearFilters,
  downloading,
  likedSkills,
  getDisplayStats,
  onDownload,
  onToggleLike,
  onCopyInstallCommand,
  onTrySkill,
}: SkillsBrowserProps) {
  return (
    <Stack space={4}>
      <FilterBar
        availableTags={availableTags}
        selectedTags={selectedTags}
        availableAudiences={availableAudiences}
        selectedAudiences={selectedAudiences}
        sortBy={sortBy}
        searchQuery={searchQuery}
        totalCount={skills?.length ?? 0}
        filteredCount={filteredSkills?.length ?? 0}
        onToggleTag={onToggleTag}
        onToggleAudience={onToggleAudience}
        onSortChange={onSortChange}
        onSearchChange={onSearchChange}
        onClearFilters={onClearFilters}
      />

      <Grid columns={[1, 1, 2, 3]} gap={[3, 3, 4, 4]}>
        {(filteredSkills ?? []).map((skill) => {
          const stats = getDisplayStats(skill._id);
          return (
            <SkillCard
              key={skill._id}
              skill={skill}
              downloads={stats.downloads}
              likes={stats.likes}
              isLiked={likedSkills[skill._id] ?? false}
              pendingReleases={releasesBySkillId[skill._id] ?? []}
              downloading={downloading}
              onDownload={onDownload}
              onToggleLike={onToggleLike}
              onCopyInstallCommand={onCopyInstallCommand}
              onTrySkill={onTrySkill}
            />
          );
        })}
      </Grid>
    </Stack>
  );
}
