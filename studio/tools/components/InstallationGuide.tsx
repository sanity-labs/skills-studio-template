import { useCallback, useEffect, useState } from "react";
import {
  Card,
  Stack,
  Flex,
  Text,
  Badge,
  Button,
  Inline,
  useToast,
} from "@sanity/ui";
import {
  ClipboardIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@sanity/icons";
import { usePublishedClient } from "../../utils/perspective";
import {
  ALL_AUDIENCES_QUERY,
  pluginFolder,
  pluginDisplayName,
  type Audience,
} from "../../utils/audiences";
import { skillsConfig } from "../../skills.config";

const REPO = `${skillsConfig.github.owner}/${skillsConfig.github.repo}`;
const MARKETPLACE = skillsConfig.marketplace.name;

const codeStyle: React.CSSProperties = {
  fontSize: "inherit",
  overflowWrap: "break-word",
};

/** Minimal accordion item — @sanity/ui has no disclosure primitive. */
function Disclosure({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card radius={2} tone="default">
      <Card
        as="button"
        padding={3}
        radius={2}
        tone="inherit"
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: "pointer", width: "100%", textAlign: "left", border: 0 }}
      >
        <Flex align="center" gap={2}>
          <Text size={1}>{open ? <ChevronDownIcon /> : <ChevronRightIcon />}</Text>
          <Text size={1} weight="bold">
            {title}
          </Text>
          {badge && (
            <Badge tone="default" fontSize={0}>
              {badge}
            </Badge>
          )}
        </Flex>
      </Card>
      {open && (
        <Card padding={3} paddingTop={0} tone="inherit">
          {children}
        </Card>
      )}
    </Card>
  );
}

function CopyCommand({
  label,
  cmd,
  onCopy,
}: {
  label?: string;
  cmd: string;
  onCopy: (text: string) => void;
}) {
  return (
    <Stack space={2}>
      <Flex align="center" justify="space-between">
        {label ? (
          <Text size={0} muted>
            {label}
          </Text>
        ) : (
          <span />
        )}
        <Button
          icon={ClipboardIcon}
          mode="ghost"
          fontSize={0}
          padding={2}
          tone="default"
          onClick={() => onCopy(cmd)}
        />
      </Flex>
      <Text size={1} muted>
        <code style={codeStyle}>{cmd}</code>
      </Text>
    </Stack>
  );
}

export function InstallationGuide() {
  const toast = useToast();
  // Published, like the rest of the explorer: these are the install commands
  // for plugins that exist on GitHub today. Under the Studio's raw client, an
  // audience edited in a release showed up twice in the picker.
  const client = usePublishedClient("2024-01-01");
  const [expanded, setExpanded] = useState(false);
  const [plugins, setPlugins] = useState<Audience[]>([]);
  const [selected, setSelected] = useState<string>(skillsConfig.everyonePluginName);

  useEffect(() => {
    client
      .fetch(ALL_AUDIENCES_QUERY)
      .then((audiences: Audience[]) =>
        setPlugins(
          audiences
            .filter((a) => (a.skillCount ?? 0) > 0)
            .sort((a, b) =>
              a.autoInstall === b.autoInstall
                ? pluginDisplayName(a).localeCompare(pluginDisplayName(b))
                : a.autoInstall
                  ? -1
                  : 1,
            ),
        ),
      )
      .catch(() => setPlugins([]));
  }, [client]);

  const handleCopy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        toast.push({ status: "success", title: "Copied to clipboard" });
      });
    },
    [toast],
  );

  const selectedAudience = plugins.find((a) => pluginFolder(a) === selected);

  return (
    <Card radius={2} tone="transparent" border>
      {/* Collapsed summary bar */}
      <Card
        as="button"
        padding={4}
        radius={2}
        tone="inherit"
        onClick={() => setExpanded((v) => !v)}
        style={{ cursor: "pointer", width: "100%", textAlign: "left", border: 0 }}
      >
        <Flex align="center" gap={3} wrap="wrap">
          <Text size={1}>
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Text>
          <Text size={1} weight="bold">
            How to install skills
          </Text>
          <Badge tone="positive" fontSize={0}>
            Claude apps: org plugins
          </Badge>
          <Text size={1} muted>
            Skills ship as one plugin per audience. The org-wide plugin is
            installed for everyone; expand for Claude Code, Cursor, Copilot,
            Codex, and ZIP options.
          </Text>
        </Flex>
      </Card>

      {expanded && (
        <Card padding={4} paddingTop={2} tone="inherit">
          <Stack space={4}>
            {/* Claude apps — the automatic path */}
            <Card padding={3} radius={2} tone="default">
              <Stack space={2}>
                <Flex align="center" gap={2}>
                  <Text size={1} weight="bold">
                    Claude App &amp; Claude.ai
                  </Text>
                  <Badge tone="positive" fontSize={0}>
                    Auto-synced
                  </Badge>
                </Flex>
                <Text size={1} muted>
                  When an admin connects this marketplace to your Claude
                  organization, the org-wide plugin can be installed for
                  everyone by default. Other audience plugins are one click
                  away under Customize &rarr; Organizational Plugins &mdash;
                  enable the ones that match your work. Skills update
                  automatically when published here.
                </Text>
              </Stack>
            </Card>

            {/* Plugin picker — drives the commands below */}
            <Stack space={2}>
              <Text size={0} muted>
                Pick a plugin &mdash; the commands below update:
              </Text>
              <Inline space={2}>
                {plugins.map((a) => {
                  const folder = pluginFolder(a);
                  return (
                    <Button
                      key={folder}
                      text={pluginDisplayName(a)}
                      mode={selected === folder ? "default" : "ghost"}
                      tone={selected === folder ? "primary" : "default"}
                      fontSize={1}
                      onClick={() => setSelected(folder)}
                    />
                  );
                })}
              </Inline>
              {selectedAudience?.pluginDescription && (
                <Text size={0} muted>
                  {selectedAudience.pluginDescription}
                </Text>
              )}
            </Stack>

            {/* Per-tool accordions */}
            <Stack space={2}>
              <Disclosure title="Claude Code">
                <Stack space={3}>
                  <CopyCommand
                    label="1. Add marketplace (once)"
                    cmd={`claude plugin marketplace add ${REPO}`}
                    onCopy={handleCopy}
                  />
                  <CopyCommand
                    label="2. Install plugin"
                    cmd={`claude plugin install ${selected}@${MARKETPLACE}`}
                    onCopy={handleCopy}
                  />
                  <CopyCommand
                    label="3. Keep background updates working (once)"
                    cmd="gh auth setup-git"
                    onCopy={handleCopy}
                  />
                  <Text size={0} muted>
                    For a private repo, background plugin updates need stored
                    git credentials — without them, updates silently stop.
                  </Text>
                </Stack>
              </Disclosure>

              <Disclosure title="Cursor 2.5+" badge="Run inside Cursor chat">
                <Stack space={3}>
                  <CopyCommand
                    label="1. Add marketplace (once)"
                    cmd={`/plugin marketplace add ${REPO}`}
                    onCopy={handleCopy}
                  />
                  <CopyCommand
                    label="2. Install plugin"
                    cmd={`/plugin install ${selected}@${MARKETPLACE}`}
                    onCopy={handleCopy}
                  />
                </Stack>
              </Disclosure>

              <Disclosure title="GitHub Copilot CLI">
                <Stack space={3}>
                  <CopyCommand
                    label="1. Add marketplace (once)"
                    cmd={`copilot plugin marketplace add ${REPO}`}
                    onCopy={handleCopy}
                  />
                  <CopyCommand
                    label="2. Install plugin"
                    cmd={`copilot plugin install ${selected}@${MARKETPLACE}`}
                    onCopy={handleCopy}
                  />
                </Stack>
              </Disclosure>

              <Disclosure title="OpenAI Codex CLI">
                <Stack space={3}>
                  <CopyCommand
                    label="1. Add marketplace (once)"
                    cmd={`codex plugin marketplace add ${REPO}`}
                    onCopy={handleCopy}
                  />
                  <CopyCommand
                    label="2. Install plugin"
                    cmd={`codex plugin add ${selected}@${MARKETPLACE}`}
                    onCopy={handleCopy}
                  />
                </Stack>
              </Disclosure>

              <Disclosure title="Skills CLI" badge="One-shot, any tool">
                <Stack space={3}>
                  <Text size={0} muted>
                    Auto-detects installed tools (Claude Code, Cursor, Codex)
                    and symlinks skills directly. Re-run to refresh.
                  </Text>
                  <CopyCommand
                    label="Single skill"
                    cmd={`npx skills add git@github.com:${REPO}.git --skill <skill-name>`}
                    onCopy={handleCopy}
                  />
                  <CopyCommand
                    label="Everything"
                    cmd={`npx skills add git@github.com:${REPO}.git`}
                    onCopy={handleCopy}
                  />
                </Stack>
              </Disclosure>

              <Disclosure title="Manual ZIP install" badge="No GitHub access">
                <Stack space={3}>
                  <Text size={1} muted>
                    Download a skill as a ZIP from the cards below, then unzip
                    into your tool&rsquo;s skills folder:
                  </Text>
                  <Text size={1} muted>
                    Claude Code:{" "}
                    <code style={codeStyle}>~/.claude/skills/&lt;skill-name&gt;/</code>
                    {" · "}Cursor:{" "}
                    <code style={codeStyle}>.cursor/skills/&lt;skill-name&gt;/</code>
                    {" · "}Copilot:{" "}
                    <code style={codeStyle}>.github/skills/</code>
                  </Text>
                </Stack>
              </Disclosure>
            </Stack>

            <Text size={0} muted>
              Needs access to{" "}
              <code style={codeStyle}>{REPO}</code>. Marketplace:{" "}
              <code style={codeStyle}>{MARKETPLACE}</code>. Plugins:{" "}
              {plugins.map((a, i) => (
                <span key={pluginFolder(a)}>
                  {i > 0 && ", "}
                  <code style={codeStyle}>{pluginFolder(a)}</code>
                </span>
              ))}
              .
            </Text>
          </Stack>
        </Card>
      )}
    </Card>
  );
}
