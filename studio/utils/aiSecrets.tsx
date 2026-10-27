/**
 * Multi-provider AI key storage via @sanity/studio-secrets.
 *
 * One namespace ('aiProviders') holds keys for all three providers.
 * Users paste any/all three in a single settings dialog.
 *
 * Backward-compat: the legacy 'anthropic' namespace's `apiKey` field
 * is read as a fallback if `aiProviders.anthropicKey` is unset. Old
 * users get a transparent migration on first use; the AI Providers
 * dialog overwrites/promotes to the new namespace as they paste keys.
 */

import {useCallback, useMemo, useState} from 'react'
import {Button, Stack, Text} from '@sanity/ui'
import {CogIcon} from '@sanity/icons'
import {useSecrets, SettingsView} from '@sanity/studio-secrets'
import type {AISecrets} from './aiProviders'

export const AI_SECRETS_NAMESPACE = 'aiProviders'

export const AI_SECRETS_KEYS = [
  {key: 'anthropicKey', title: 'Anthropic API Key (Claude)'},
  {key: 'openaiKey', title: 'OpenAI API Key (GPT)'},
  {key: 'geminiKey', title: 'Google API Key (Gemini)'},
  {key: 'openrouterKey', title: 'OpenRouter API Key'},
]

/** Legacy namespace from before the multi-provider split. Read-only. */
const LEGACY_ANTHROPIC_NAMESPACE = 'anthropic'

interface UseAISecretsResult {
  secrets: AISecrets
  loading: boolean
  hasAnyKey: boolean
}

/**
 * Read AI provider secrets, merging the legacy 'anthropic' namespace
 * into the new shape for back-compat. The new namespace wins if both
 * have an Anthropic key.
 */
export function useAISecrets(): UseAISecretsResult {
  const {secrets: nu, loading: loadingNew} = useSecrets<AISecrets>(AI_SECRETS_NAMESPACE)
  const {secrets: legacy, loading: loadingLegacy} = useSecrets<{apiKey?: string}>(
    LEGACY_ANTHROPIC_NAMESPACE,
  )

  return useMemo(() => {
    const merged: AISecrets = {
      anthropicKey: nu?.anthropicKey || legacy?.apiKey,
      openaiKey: nu?.openaiKey,
      geminiKey: nu?.geminiKey,
      openrouterKey: nu?.openrouterKey,
    }
    return {
      secrets: merged,
      loading: loadingNew || loadingLegacy,
      hasAnyKey: Boolean(merged.anthropicKey || merged.openaiKey || merged.geminiKey),
    }
  }, [nu, legacy, loadingNew, loadingLegacy])
}

/**
 * Button that opens the AI Providers settings dialog. Use this anywhere
 * a user needs to add/update API keys (e.g. as a toolbar action in
 * Skill Lab or Prose Pick).
 */
export function AIProvidersSettingsButton({
  text = 'API Keys',
  tone = 'default',
  mode = 'ghost',
}: {
  text?: string
  tone?: 'default' | 'primary' | 'positive' | 'caution' | 'critical'
  mode?: 'default' | 'ghost' | 'bleed'
}) {
  const [open, setOpen] = useState(false)
  const handleClose = useCallback(() => setOpen(false), [])
  return (
    <>
      <Button
        icon={CogIcon}
        text={text}
        tone={tone}
        mode={mode}
        fontSize={1}
        onClick={() => setOpen(true)}
      />
      {open && (
        <SettingsView
          namespace={AI_SECRETS_NAMESPACE}
          keys={AI_SECRETS_KEYS}
          title="AI Providers"
          onClose={handleClose}
        />
      )}
    </>
  )
}

/**
 * Empty-state component shown when no API key is configured. Pair with
 * AIProvidersSettingsButton so the user can dismiss/return cleanly.
 */
export function AIProvidersEmptyState({
  message = 'No AI provider keys configured yet. Add at least one to run.',
}: {
  message?: string
}) {
  return (
    <Stack space={3} padding={3}>
      <Text size={1} muted>
        {message}
      </Text>
      <AIProvidersSettingsButton text="Configure API keys" tone="primary" mode="default" />
    </Stack>
  )
}
