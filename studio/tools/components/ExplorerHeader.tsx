import { Box, Stack, Flex, Text, Heading, Button } from "@sanity/ui";
import { DownloadIcon, LaunchIcon } from "@sanity/icons";
import { REPO_URL } from "./constants";

interface ExplorerHeaderProps {
  downloading: string | null;
  onDownloadAll: () => void;
}

export function ExplorerHeader({
  downloading,
  onDownloadAll,
}: ExplorerHeaderProps) {
  return (
    <Stack space={4}>
      <Flex
        justify="space-between"
        align="flex-start"
        direction={["column", "column", "row"]}
        gap={4}
      >
        <Stack space={4}>
          <Heading size={3}>Skills Explorer</Heading>
          <Text size={2} muted>
            Skills are structured knowledge packs for AI agents. Each skill
            contains a SKILL.md (the main instructions your AI agent follows)
            and optional reference files (extra detail the agent can look up
            when needed).
          </Text>
          <Text size={2} muted>
            Download a ZIP and install it into your agent, or use the{" "}
            <a
              href="https://github.com/vercel-labs/skills"
              target="_blank"
              rel="noopener noreferrer"
            >
              Skills CLI
            </a>{" "}
            if you have GitHub access.
          </Text>
        </Stack>
        <Box flex="none">
          <Stack space={2}>
            <Text size={0} muted align="right">
              <em>Download All sends each skill as a separate ZIP</em>
            </Text>
            <Flex gap={2} align="center" justify="flex-end">
              <Button
                as="a"
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                icon={LaunchIcon}
                text="GitHub Repo"
                mode="ghost"
              />
              <Button
                icon={DownloadIcon}
                text={downloading === "all" ? "Downloading…" : "Download All"}
                tone="primary"
                onClick={onDownloadAll}
                disabled={downloading !== null}
              />
            </Flex>
          </Stack>
        </Box>
      </Flex>
    </Stack>
  );
}
