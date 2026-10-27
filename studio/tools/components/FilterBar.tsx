import {
  Box,
  Stack,
  Flex,
  Text,
  Button,
  TextInput,
  Menu,
  MenuButton,
  MenuItem,
  Select,
} from "@sanity/ui";
import { FilterIcon, CheckmarkIcon, SearchIcon, UsersIcon } from "@sanity/icons";
import { SORT_OPTIONS } from "./constants";
import type { SortOption } from "./constants";

/** An audience, as the explorer needs it: the plugin a skill ships in. */
export interface AudienceOption {
  _id: string;
  title: string;
  autoInstall: boolean;
}

interface FilterBarProps {
  availableTags: string[];
  selectedTags: string[];
  availableAudiences: AudienceOption[];
  selectedAudiences: string[];
  sortBy: SortOption;
  searchQuery: string;
  totalCount: number;
  filteredCount: number;
  onToggleTag: (tag: string) => void;
  onToggleAudience: (audienceId: string) => void;
  onSortChange: (sort: SortOption) => void;
  onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearFilters: () => void;
}

export function FilterBar({
  availableTags,
  selectedTags,
  availableAudiences,
  selectedAudiences,
  sortBy,
  searchQuery,
  totalCount,
  filteredCount,
  onToggleTag,
  onToggleAudience,
  onSortChange,
  onSearchChange,
  onClearFilters,
}: FilterBarProps) {
  const hasActiveFilters =
    selectedTags.length > 0 || selectedAudiences.length > 0 || !!searchQuery;

  return (
    <Stack space={3}>
      <Flex gap={3} direction={["column", "column", "row"]}>
        {availableAudiences.length > 0 && (
          <MenuButton
            id="audience-filter"
            button={
              <Button
                icon={UsersIcon}
                text={
                  selectedAudiences.length > 0
                    ? `Audiences (${selectedAudiences.length})`
                    : "Audiences"
                }
                mode="ghost"
                tone={selectedAudiences.length > 0 ? "primary" : "default"}
              />
            }
            menu={
              <Menu style={{ maxHeight: 320, overflowY: "auto" }}>
                {availableAudiences.map((audience) => (
                  <MenuItem
                    key={audience._id}
                    pressed={selectedAudiences.includes(audience._id)}
                    icon={
                      selectedAudiences.includes(audience._id)
                        ? CheckmarkIcon
                        : undefined
                    }
                    text={
                      audience.autoInstall
                        ? `${audience.title} (auto-installed)`
                        : audience.title
                    }
                    onClick={() => onToggleAudience(audience._id)}
                  />
                ))}
              </Menu>
            }
            popover={{ portal: true }}
          />
        )}
        <MenuButton
          id="tag-filter"
          button={
            <Button
              icon={FilterIcon}
              text={
                selectedTags.length > 0
                  ? `Tags (${selectedTags.length})`
                  : "Tags"
              }
              mode="ghost"
              tone={selectedTags.length > 0 ? "primary" : "default"}
            />
          }
          menu={
            <Menu style={{ maxHeight: 320, overflowY: "auto" }}>
              {availableTags.map((tag) => (
                <MenuItem
                  key={tag}
                  pressed={selectedTags.includes(tag)}
                  icon={selectedTags.includes(tag) ? CheckmarkIcon : undefined}
                  text={tag}
                  onClick={() => onToggleTag(tag)}
                />
              ))}
            </Menu>
          }
          popover={{ portal: true }}
        />
        <Box>
          <Select
            value={sortBy}
            onChange={(e) => onSortChange(e.currentTarget.value as SortOption)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.title}
              </option>
            ))}
          </Select>
        </Box>
        <Box flex={1}>
          <TextInput
            icon={SearchIcon}
            placeholder="Search skills…"
            value={searchQuery}
            onChange={onSearchChange}
          />
        </Box>
        {hasActiveFilters && (
          <Button
            text="Clear filters"
            mode="bleed"
            tone="default"
            fontSize={1}
            onClick={onClearFilters}
          />
        )}
      </Flex>
      {hasActiveFilters && (
        <Text size={1} muted>
          Showing {filteredCount} of {totalCount} skills
        </Text>
      )}
    </Stack>
  );
}
