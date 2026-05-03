export interface WhisperClient {
  transcribe(audio: ArrayBuffer): Promise<string>
}

type FetchFn = typeof fetch

export interface CloudWhisperOpts {
  apiKey: string
  fetch?: FetchFn
  timeoutMs?: number
}

export class CloudWhisperClient implements WhisperClient {
  private apiKey: string
  private fetch: FetchFn
  private timeoutMs: number

  constructor(opts: CloudWhisperOpts) {
    this.apiKey = opts.apiKey
    this.fetch = opts.fetch ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  async transcribe(audio: ArrayBuffer): Promise<string> {
    if (!this.apiKey) throw new Error('OpenAI API key not configured')

    const form = new FormData()
    form.append('file', new Blob([audio], { type: 'audio/webm' }), 'audio.webm')
    form.append('model', 'whisper-1')

    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await this.fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: ctl.signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Whisper ${res.status}: ${body || res.statusText}`)
      }
      const json = await res.json() as { text?: string }
      return (json.text ?? '').trim()
    } finally {
      clearTimeout(t)
    }
  }
}
