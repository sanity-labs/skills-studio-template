/**
 * React hooks for the comparison with other skills, shared by the Publish
 * gate, the "Compare with other skills" dialog and the panel on the form.
 */
import {useCallback, useEffect, useState} from 'react'
import {useClient} from 'sanity'
import {getPublishedId} from '../utils/documentIds'
import {decide} from '../utils/jev'
import {runOverlapCheck, type CheckResult} from '../utils/overlapCheck'
import {loadCheckInput, saveCheckResult, type CheckedSkill} from '../utils/overlapCheckData'
import {evaluateGate, loadGateDocs, type GateResult, type StoredQuality} from '../utils/skillGate'
import {qualityId, textHash} from '../utils/skillSignals'
import {useAISecrets} from '../utils/aiSecrets'

const API_VERSION = 'v2025-02-19'

export type SkillText = {id: string; skillName?: string; description?: string; content?: string}

export type GateState = {
  loading: boolean
  result: GateResult | null
  quality: StoredQuality | null
  /** Fingerprints of the text as it is now. */
  descriptionHash: string | null
  bodyHash: string | null
  /** 'never' compared, 'stale' since the text changed, or 'current'. */
  freshness: 'never' | 'stale' | 'current' | null
}

/**
 * The gate for one skill, kept current: re-read when the text changes or when
 * a comparison saves new results. Fails open, so a check outage never stops
 * anyone; the sync is where distribution is enforced.
 */
export function useSkillGate({id: rawId, skillName, description = '', content = ''}: SkillText): GateState {
  const client = useClient({apiVersion: API_VERSION})
  const id = getPublishedId(rawId)
  const [state, setState] = useState<Omit<GateState, 'loading'>>({
    result: null,
    quality: null,
    descriptionHash: null,
    bodyHash: null,
    freshness: null,
  })
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const subscription = client
      .listen(`*[_id == $qualityId || (_type == "skillRelation" && references($id))]`, {id, qualityId: qualityId(id)}, {
        visibility: 'query',
      })
      .subscribe(() => setRefreshKey((k) => k + 1))
    return () => subscription.unsubscribe()
  }, [client, id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([loadGateDocs(client, id), textHash(description), textHash(content)])
      .then(([{quality, relations}, descriptionHash, bodyHash]) => {
        if (cancelled) return
        const checkedDescription = quality?.lint?.descriptionHash ?? quality?.routing?.descriptionHash
        const freshness = !checkedDescription
          ? 'never'
          : checkedDescription !== descriptionHash || (quality?.bodyHash && quality.bodyHash !== bodyHash)
            ? 'stale'
            : 'current'
        setState({
          result: evaluateGate({skillId: id, skillName: skillName ?? 'this skill', descriptionHash, bodyHash, quality, relations}),
          quality,
          descriptionHash,
          bodyHash,
          freshness,
        })
      })
      .catch((err) => {
        console.warn('[useSkillGate] comparison results unavailable:', err)
        if (!cancelled) setState({result: null, quality: null, descriptionHash: null, bodyHash: null, freshness: null})
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [client, id, skillName, description, content, refreshKey])

  return {loading, ...state}
}

export type CompareRun = {
  phase: 'idle' | 'running' | 'done' | 'error'
  progress: string
  error: string | null
  /** The comparison just run, and the gate read back after saving it. */
  outcome: {result: CheckResult; gate: GateResult; partial: boolean} | null
  hasKey: boolean
  keysLoading: boolean
  run: () => Promise<void>
}

/** Run the comparison for the skill as it is now, and save it. */
export function useCompareSkill(current: CheckedSkill): CompareRun {
  const client = useClient({apiVersion: API_VERSION})
  const {secrets, loading: keysLoading} = useAISecrets()
  const [phase, setPhase] = useState<CompareRun['phase']>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<CompareRun['outcome']>(null)

  const run = useCallback(async () => {
    setPhase('running')
    setError(null)
    try {
      setProgress('Loading skills and test requests')
      const {input, embeddingError} = await loadCheckInput(client, current)
      const result = await runOverlapCheck(input, {
        decide: (state, questions) => decide({apiKey: secrets.openrouterKey ?? '', state, questions}),
        now: () => new Date().toISOString(),
        onProgress: setProgress,
      })
      setProgress('Saving results')
      const gate = await saveCheckResult(client, result, current.skillName ?? result.self.name)
      setOutcome({result, gate, partial: Boolean(embeddingError)})
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [client, current, secrets.openrouterKey])

  return {phase, progress, error, outcome, hasKey: Boolean(secrets.openrouterKey), keysLoading, run}
}
