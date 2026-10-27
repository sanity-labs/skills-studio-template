/**
 * @deprecated Use `studio/utils/aiProviders.ts` instead.
 *
 * Thin re-export shim from the days when Skill Lab only supported Anthropic.
 * The shared registry now covers Claude + GPT + Gemini.
 *
 * Existing call sites get migrated piecemeal. New code should import from
 * `../../utils/aiProviders` directly.
 */

export {MODELS as ANTHROPIC_MODELS, type ModelId as AnthropicModelId, generateText} from '../../utils/aiProviders'
export type {AISecrets} from '../../utils/aiProviders'

// Legacy callAnthropic() is preserved as a thin wrapper so RunAllButton
// can be migrated in a separate commit without breaking the build.
import {generateText as _generateText, type AISecrets as _AISecrets} from '../../utils/aiProviders'

export async function callAnthropic({
  apiKey,
  model,
  system,
  userMessage,
  maxTokens = 8192,
}: {
  apiKey: string
  model: string
  system?: string
  userMessage: string
  maxTokens?: number
}): Promise<string> {
  const secrets: _AISecrets = {anthropicKey: apiKey}
  return _generateText({model, system, user: userMessage, maxTokens, secrets})
}
