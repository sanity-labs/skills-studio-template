import {describe, it, expect, vi} from 'vitest'
import {DECISIONS_URL, decide, pairState, routingQuestions, DESCRIPTION_PAIR_QUESTIONS} from '../jev'
import {JEV_MODEL, NO_SKILL} from '../skillSignals'

const ok = (body: unknown) => new Response(JSON.stringify(body), {status: 200})
const answers = {same_trigger: {type: 'noul', noul: 0.2}}

describe('decide', () => {
  it('posts the documented Decisions shape with the key as a bearer token', async () => {
    const fetch = vi.fn(async () => ok({answers, usage: {input_tokens: 1, output_tokens: 1, cost: 0.00001}}))
    await decide({apiKey: 'sk-test', state: {a: 1}, questions: DESCRIPTION_PAIR_QUESTIONS, fetch})

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(DECISIONS_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string)).toEqual({model: JEV_MODEL, state: {a: 1}, questions: DESCRIPTION_PAIR_QUESTIONS})
  })

  it('returns the answers and the cost', async () => {
    const fetch = vi.fn(async () => ok({answers, usage: {input_tokens: 1, output_tokens: 1, cost: 0.00002}}))
    const result = await decide({apiKey: 'k', state: 's', questions: {}, fetch})
    expect(result.answers).toEqual(answers)
    expect(result.cost).toBe(0.00002)
  })

  it('retries a rate limit and then succeeds', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', {status: 429}))
      .mockResolvedValueOnce(ok({answers, usage: {}}))
    const result = await decide({apiKey: 'k', state: 's', questions: {}, fetch, retryDelayMs: 0})
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.answers).toEqual(answers)
  })

  it('fails at once on a bad request, naming the status and the reason', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"criteria must have true and false"}', {status: 400}))
    await expect(decide({apiKey: 'k', state: 's', questions: {}, fetch, retryDelayMs: 0})).rejects.toThrow(
      /400.*criteria must have true and false/,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })


  it('refuses to call without a key rather than sending an empty bearer', async () => {
    const fetch = vi.fn()
    await expect(decide({apiKey: '', state: 's', questions: {}, fetch})).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('pairState', () => {
  const a = {skillName: 'a', title: 'A', description: 'does a', content: 'body a'}
  const b = {skillName: 'b', title: 'B', description: 'does b', content: 'body b'}

  it('leaves bodies out of a description comparison', () => {
    expect(JSON.stringify(pairState(a, b, {withBody: false}))).not.toContain('body a')
  })

  it('includes bodies when asked', () => {
    expect(pairState(a, b, {withBody: true}).skill_b).toMatchObject({name: 'b', body: 'body b'})
  })
})

describe('routingQuestions', () => {
  it('offers every skill and the no-skill answer', () => {
    const q = routingQuestions([
      {skillName: 'a', description: 'does a'},
      {skillName: 'b', description: 'does b'},
    ])
    expect(Object.keys(q.skill.criteria as Record<string, string>)).toEqual(['a', 'b', NO_SKILL])
  })
})
