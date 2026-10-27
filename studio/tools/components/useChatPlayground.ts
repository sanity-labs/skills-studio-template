import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { SanityClient } from "sanity";
import type { ChatMessage } from "./constants";
import type { Skill } from "../../types";

interface UseChatPlaygroundOptions {
  skills: Skill[] | null;
  client: SanityClient;
}

function buildInstruction(skill: Skill): string {
  let instruction = skill.content || "";
  if (skill.references?.length) {
    instruction += "\n\n---\nReference materials:\n\n";
    for (const ref of skill.references) {
      if (!ref) continue;
      instruction += `## ${ref.filename}\n\n${ref.content}\n\n`;
    }
  }
  return instruction;
}

export function useChatPlayground({ skills, client }: UseChatPlaygroundOptions) {
  const [chatSkillId, setChatSkillId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  const vxClient = useMemo(
    () => client.withConfig({ apiVersion: "vX" }),
    [client],
  );

  const chatSkill = useMemo(() => {
    if (!chatSkillId || !skills) return null;
    return skills.find((s: Skill) => s._id === chatSkillId) || null;
  }, [chatSkillId, skills]);

  const handleTrySkill = useCallback(
    async (skillId: string) => {
      const skill = skills?.find((s: Skill) => s._id === skillId);
      if (!skill) return;

      setChatSkillId(skillId);
      setChatMessages([]);
      setChatInput("");
      setChatLoading(true);

      try {
        const response = await vxClient.agent.action.prompt({
          instruction:
            "You are an AI assistant with the following skill loaded. Introduce yourself in one sentence. Be helpful and concise.\n\n$skillContent",
          instructionParams: {
            skillContent: buildInstruction(skill),
          },
        });
        setChatMessages([
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: typeof response === "string" ? response : String(response),
          },
        ]);
      } catch (err) {
        console.error("Welcome message failed:", err);
        setChatMessages([
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Hi! I'm the **${skill.title || skill.skillName}** skill. Ask me anything!`,
          },
        ]);
      }
      setChatLoading(false);
    },
    [skills, vxClient],
  );

  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !chatSkill || chatLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: chatInput.trim(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      const history = [...chatMessages, userMessage]
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");

      const response = await vxClient.agent.action.prompt({
        instruction: `You are an AI assistant with the following skill loaded.
Use it to answer the user's questions helpfully. Use markdown formatting.

$skillContent

Conversation so far:
$history

User's latest message: $userMessage`,
        instructionParams: {
          skillContent: buildInstruction(chatSkill),
          history,
          userMessage: userMessage.content,
        },
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: typeof response === "string" ? response : String(response),
        },
      ]);
    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ]);
    }
    setChatLoading(false);
  }, [chatInput, chatSkill, chatMessages, chatLoading, vxClient]);

  const handleClearChat = useCallback(() => {
    if (chatSkillId) {
      handleTrySkill(chatSkillId);
    }
  }, [chatSkillId, handleTrySkill]);

  const handleCloseChat = useCallback(() => {
    setChatSkillId(null);
    setChatMessages([]);
    setChatInput("");
    setChatLoading(false);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading]);

  // Inject streamdown CSS bridge styles
  useEffect(() => {
    const id = "streamdown-bridge-css";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
[data-streamdown] {
  --sd-font-size: 0.8125rem;
  --sd-line-height: 1.5;
  --sd-font-family: inherit;
  --sd-code-font: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
  --sd-text-color: var(--card-fg-color);
  --sd-muted-color: var(--card-muted-fg-color);
  --sd-border-color: var(--card-border-color);
  --sd-bg-color: transparent;
  --sd-code-bg: var(--card-code-bg-color, rgba(128, 128, 128, 0.1));
  --sd-radius: 3px;
}
[data-streamdown] pre { border-radius: 3px; padding: 0.75rem; }
[data-streamdown] code { font-size: 0.75rem; }
[data-streamdown] a { color: var(--card-link-color, var(--card-fg-color)); text-decoration: underline; }
[data-streamdown] p { margin: 0.5em 0; }
[data-streamdown] p:first-child { margin-top: 0; }
[data-streamdown] p:last-child { margin-bottom: 0; }
`;
    document.head.appendChild(style);
  }, []);

  return {
    chatSkill,
    chatMessages,
    chatInput,
    chatLoading,
    chatMessagesRef,
    setChatInput,
    handleTrySkill,
    handleSendMessage,
    handleClearChat,
    handleCloseChat,
  };
}
