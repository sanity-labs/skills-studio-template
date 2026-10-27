import { useState, useCallback, useEffect } from "react";
import { useClient } from "sanity";
import {
  Card,
  Stack,
  Flex,
  Text,
  Button,
  Spinner,
} from "@sanity/ui";
import { ResetIcon } from "@sanity/icons";
import type { Skill } from "../../types";

export function FortuneQuote({ skills }: { skills: Skill[] }) {
  const client = useClient({ apiVersion: "2024-01-01" });
  const [quote, setQuote] = useState<string | null>(null);
  const [skillName, setSkillName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const generateQuote = useCallback(async () => {
    if (!skills.length) return;
    setLoading(true);

    // Pick a random skill
    const skill = skills[Math.floor(Math.random() * skills.length)];
    setSkillName(skill.skillName);

    try {
      const result = await client
        .withConfig({ apiVersion: "vX" })
        .agent.action.prompt({
          instruction: `You are "$skillName". Here is what you teach:\n\n$content\n\nWrite one dry, funny one-liner about your purpose. Under 140 characters. No hashtags. No quotes around the text.`,
          instructionParams: {
            skillName: skill.skillName,
            content: (skill.content || "").slice(0, 2000),
          },
        });
      setQuote(result);
    } catch (err) {
      console.error("Fortune quote failed:", err);
      setQuote(null);
      setError(true);
    }
    setLoading(false);
  }, [skills, client]);

  useEffect(() => {
    generateQuote();
  }, []); // Only on mount — don't re-run when skills update

  if (error || (!quote && !loading)) return null;

  return (
    <Card padding={4} radius={2} tone="transparent" border>
      <Flex align="center" gap={3}>
        <Stack space={2} flex={1}>
          {loading ? (
            <Flex align="center" gap={2}>
              <Spinner muted size={1} />
              <Text size={2} muted>
                <em>Consulting the Content Lake…</em>
              </Text>
            </Flex>
          ) : (
            <>
              <Text size={2}>
                <em>&ldquo;{quote}&rdquo;</em>
              </Text>
              <Text size={0} muted>
                — {skillName}
              </Text>
            </>
          )}
        </Stack>
        {!loading && (
          <Button
            icon={ResetIcon}
            mode="ghost"
            tone="default"
            onClick={generateQuote}
            title="New fortune"
          />
        )}
      </Flex>
    </Card>
  );
}
