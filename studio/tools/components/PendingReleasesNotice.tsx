import { Badge, Card, Flex, Inline, Stack, Text } from "@sanity/ui";
import { CalendarIcon } from "@sanity/icons";
import { useRouter } from "sanity/router";
import type { PendingRelease } from "./useSkillReleases";

/**
 * Says what is queued in content releases, above a list of published skills.
 *
 * Every skill name links into that release's version of the skill: the
 * `perspective` search param is what Studio itself uses to share a link to a
 * document inside a release, so the form opens showing the pending change
 * rather than the published copy.
 */
export function PendingReleasesNotice({
  releases,
  skillCount,
}: {
  releases: PendingRelease[];
  skillCount: number;
}) {
  const router = useRouter();

  if (releases.length === 0) return null;

  return (
    <Card padding={4} radius={2} tone="primary" border>
      <Flex gap={3} align="flex-start">
        <Text size={2}>
          <CalendarIcon />
        </Text>
        <Stack space={4} flex={1}>
          <Stack space={2}>
            <Text size={1} weight="semibold">
              {skillCount} skill{skillCount === 1 ? "" : "s"} with pending
              changes in {releases.length} content release
              {releases.length === 1 ? "" : "s"}
            </Text>
            <Text size={1} muted>
              The skills below are the published ones — what{" "}
              <code>npx skills add</code> installs today. The work queued here
              lands when its release publishes.
            </Text>
          </Stack>

          {releases.map((release) => (
            <Stack space={3} key={release.releaseId}>
              <Text size={1} weight="medium">
                {release.title}
              </Text>
              <Inline space={2}>
                {release.skills.map((skill) => (
                  <Text size={1} key={`${release.releaseId}-${skill.publishedId}`}>
                    <a
                      href={router.resolveIntentLink(
                        "edit",
                        { id: skill.publishedId, type: "skill" },
                        // Opens the document with this release selected
                        [["perspective", release.releaseId]],
                      )}
                    >
                      {skill.skillName || skill.publishedId}
                    </a>
                    {skill.unpublish && (
                      <>
                        {" "}
                        <Badge tone="critical" fontSize={0}>
                          to be removed
                        </Badge>
                      </>
                    )}
                  </Text>
                ))}
              </Inline>
            </Stack>
          ))}
        </Stack>
      </Flex>
    </Card>
  );
}
