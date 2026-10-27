import {
  Card,
  Stack,
  Flex,
  Text,
  Heading,
  Button,
  Badge,
  Inline,
} from "@sanity/ui";
import {
  DownloadIcon,
  CopyIcon,
  EditIcon,
  HeartIcon,
  HeartFilledIcon,
  LockIcon,
  PlayIcon,
  UsersIcon,
} from "@sanity/icons";
import { useIntentLink } from "sanity/router";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import { getPublishedId } from "../../utils/documentIds";
import { ORG_NAME } from "../../utils/constants";
import { reviewOverdueDays } from "../../components/reviewStatus";
import type { PendingRelease } from "./useSkillReleases";
import type { Skill } from "../../types";

interface SkillCardProps {
  skill: Skill;
  downloads: number;
  likes: number;
  isLiked: boolean;
  /** Releases holding an unpublished version of this skill. */
  pendingReleases: PendingRelease[];
  downloading: string | null;
  onDownload: (skill: Skill) => void;
  onToggleLike: (skillId: string) => void;
  onCopyInstallCommand: (skillName: string) => void;
  onTrySkill: (skillId: string) => void;
}

export function SkillCard({
  skill,
  downloads,
  likes,
  isLiked,
  pendingReleases,
  downloading,
  onDownload,
  onToggleLike,
  onCopyInstallCommand,
  onTrySkill,
}: SkillCardProps) {
  // An `edit` intent, not a hand-built `/structure/...` path: the router
  // resolves it to whichever pane handles skills, adds the Studio base path,
  // and carries the sticky `perspective` param. The old hand-built href did
  // none of that, which is how Edit landed on an empty pane. To open a
  // release's version of a skill instead, use the links in the pending-release
  // notice — those set the perspective explicitly.
  const editLink = useIntentLink({
    intent: "edit",
    params: { id: getPublishedId(skill._id), type: "skill" },
  });

  return (
    <Card padding={4} radius={2} border display="flex">
      <Flex direction="column" flex={1}>
        <Stack space={3} flex={1}>
          <Flex align="center" gap={2} wrap="wrap" justify={"flex-start"}>
            {skill.metadata?.visibility === "confidential" && (
              <Text size={2} title={`Confidential — do not share outside ${ORG_NAME}`}>
                <LockIcon />
              </Text>
            )}
            <Heading size={1}>{skill.title || skill.skillName}</Heading>
            <Badge tone="primary" fontSize={0}>
              {skill.referenceCount} ref
              {skill.referenceCount !== 1 ? "s" : ""}
            </Badge>
            {reviewOverdueDays(skill) != null && (
              <Badge tone="caution" fontSize={0} title="Older than its review cadence">
                Review overdue
              </Badge>
            )}
            {pendingReleases.length > 0 && (
              <Badge
                tone="primary"
                fontSize={0}
                title={`Unpublished changes in: ${pendingReleases
                  .map((release) => release.title)
                  .join(", ")} — this card shows the published skill`}
              >
                {pendingReleases.length === 1
                  ? `Pending in ${pendingReleases[0].title}`
                  : `Pending in ${pendingReleases.length} releases`}
              </Badge>
            )}
          </Flex>
          {skill.audiences && skill.audiences.length > 0 && (
            <Flex gap={2} align="center" wrap="wrap">
              <Text size={0} muted title="The plugins this skill ships in">
                <UsersIcon />
              </Text>
              {skill.audiences.map((audience) =>
                audience?._id ? (
                  <Badge key={audience._id} tone="primary" fontSize={0}>
                    {audience.title || audience.slug}
                  </Badge>
                ) : null,
              )}
            </Flex>
          )}
          {skill.metadata?.tags && skill.metadata.tags.length > 0 && (
            <Inline space={1}>
              {skill.metadata.tags.map((tag: string) => (
                <Badge key={tag} tone="default" fontSize={0}>
                  {tag}
                </Badge>
              ))}
            </Inline>
          )}

          <Flex gap={3} wrap="wrap" direction={"row"}>
            {(skill.lastPublishedAt || skill._updatedAt) && (
              <Text size={0} muted>
                {skill.lastPublishedAt
                  ? `Published to GitHub ${formatRelativeTime(skill.lastPublishedAt)}`
                  : `Last edited ${formatRelativeTime(skill._updatedAt)}`}
              </Text>
            )}
            {downloads > 0 && (
              <Text size={0} muted>
                {downloads} download
                {downloads !== 1 ? "s" : ""}
              </Text>
            )}
          </Flex>
          <Flex gap={2} wrap="wrap" align="center">
            <Button
              icon={isLiked ? HeartFilledIcon : HeartIcon}
              text={`${likes}`}
              mode="ghost"
              tone={isLiked ? "critical" : "default"}
              onClick={() => onToggleLike(skill._id)}
              title={isLiked ? "Unlike this skill" : "Like this skill"}
            />
            <Button
              as="a"
              href={editLink.href}
              onClick={editLink.onClick}
              icon={EditIcon}
              text="Edit"
              mode="ghost"
            />
            <Button
              icon={CopyIcon}
              text="Copy CLI Install"
              mode="ghost"
              title="Requires GitHub SSH access"
              onClick={() => onCopyInstallCommand(skill.skillName)}
            />
            <Button
              icon={DownloadIcon}
              text={downloading === skill._id ? "Downloading…" : "Download ZIP"}
              tone="positive"
              onClick={() => onDownload(skill)}
              disabled={downloading !== null}
            />
            <Button
              icon={PlayIcon}
              text="Try"
              mode="ghost"
              onClick={() => onTrySkill(skill._id)}
            />
          </Flex>
          <Text size={1} muted>
            {skill.description}
          </Text>
        </Stack>
      </Flex>
    </Card>
  );
}
