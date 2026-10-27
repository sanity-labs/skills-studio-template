import { lazy, Suspense } from "react";
import {
  Box,
  Card,
  Stack,
  Flex,
  Text,
  Button,
  Spinner,
  TextInput,
} from "@sanity/ui";
import { ResetIcon, PlayIcon, CloseIcon } from "@sanity/icons";
import type { ChatMessage } from "./constants";
import type { Skill } from "../../types";

// Lazy-load streamdown to avoid breaking Sanity manifest extraction (Node.js)
const LazyStreamdown = lazy(() =>
  import("streamdown").then((mod) => ({ default: mod.Streamdown })),
);

interface ChatPlaygroundProps {
  skill: Skill;
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  messagesRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onClear: () => void;
  onClose: () => void;
}

export function ChatPlayground({
  skill,
  messages,
  input,
  loading,
  messagesRef,
  onInputChange,
  onSendMessage,
  onClear,
  onClose,
}: ChatPlaygroundProps) {
  return (
    <Card
      padding={4}
      radius={2}
      border
      tone="transparent"
      style={{ flex: 1, minHeight: 0 }}
    >
      <Flex direction="column" gap={3} style={{ height: "100%" }}>
        {/* Chat header */}
        <Flex align="center" justify="space-between">
          <Stack space={2}>
            <Flex align="center" gap={2}>
              <PlayIcon />
              <Text weight="bold">
                Testing: {skill.title || skill.skillName}
              </Text>
            </Flex>
            <Text size={0} muted>
              <em>
                Powered by Agent Actions (
                <code>client.agent.action.prompt</code>)
              </em>
            </Text>
          </Stack>
          <Flex gap={2}>
            <Button
              text="Clear"
              mode="ghost"
              onClick={onClear}
              icon={ResetIcon}
              disabled={loading}
            />
            <Button
              text="Close"
              mode="ghost"
              tone="critical"
              onClick={onClose}
              icon={CloseIcon}
            />
          </Flex>
        </Flex>

        {/* Messages area */}
        <Card
          ref={messagesRef}
          padding={3}
          radius={2}
          tone="default"
          overflow="auto"
          style={{ flex: 1, minHeight: 0 }}
        >
          <Stack space={3}>
            {messages.map((msg) => (
              <Flex
                key={msg.id}
                justify={msg.role === "user" ? "flex-end" : "flex-start"}
              >
                <Box style={{ maxWidth: "80%" }}>
                  <Card
                    padding={3}
                    radius={2}
                    tone={msg.role === "user" ? "primary" : "default"}
                    border={msg.role === "assistant"}
                  >
                    {msg.role === "assistant" ? (
                      <div data-streamdown="">
                        <Suspense
                          fallback={<Text size={1}>{msg.content}</Text>}
                        >
                          <LazyStreamdown>{msg.content}</LazyStreamdown>
                        </Suspense>
                      </div>
                    ) : (
                      <Text size={1}>{msg.content}</Text>
                    )}
                  </Card>
                </Box>
              </Flex>
            ))}
            {loading && (
              <Flex align="center" gap={2} padding={2}>
                <Spinner muted size={1} />
                <Text size={1} muted>
                  Thinking…
                </Text>
              </Flex>
            )}
          </Stack>
        </Card>

        {/* Input area */}
        <Flex gap={2}>
          <Box flex={1}>
            <TextInput
              placeholder="Type a message…"
              value={input}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onInputChange(e.currentTarget.value)
              }
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendMessage();
                }
              }}
              disabled={loading}
            />
          </Box>
          <Button
            text="Send"
            tone="primary"
            onClick={onSendMessage}
            disabled={!input.trim() || loading}
          />
        </Flex>
      </Flex>
    </Card>
  );
}
