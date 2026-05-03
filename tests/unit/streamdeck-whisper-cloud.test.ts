import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CloudWhisperClient } from '../../src/main/streamdeck/whisper-client'

describe('CloudWhisperClient', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('POSTs the audio to OpenAI and returns the transcript text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello orchestrator' }),
    })
    const client = new CloudWhisperClient({ apiKey: 'sk-test', fetch: fetchMock })
    const audio = new ArrayBuffer(16)
    const text = await client.transcribe(audio)

    expect(text).toBe('hello orchestrator')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-test' })
  })

  it('throws a typed error on 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 401,
      text: async () => '{"error":{"message":"bad key"}}',
    })
    const client = new CloudWhisperClient({ apiKey: 'sk-test', fetch: fetchMock })
    await expect(client.transcribe(new ArrayBuffer(16))).rejects.toThrow(/bad key/)
  })

  it('rejects when API key is missing', async () => {
    const client = new CloudWhisperClient({ apiKey: '', fetch: vi.fn() })
    await expect(client.transcribe(new ArrayBuffer(16))).rejects.toThrow(/api key/i)
  })

  it('aborts on timeout', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        ;(init.signal as AbortSignal).addEventListener('abort', () =>
          reject(new Error('aborted')))
      })
    })
    const client = new CloudWhisperClient({ apiKey: 'sk-test', fetch: fetchMock, timeoutMs: 50 })
    await expect(client.transcribe(new ArrayBuffer(16))).rejects.toThrow(/aborted|timed out/i)
  })
})
