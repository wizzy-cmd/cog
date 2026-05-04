import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

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

export interface LocalWhisperOpts {
  model?: string  // default: 'base.en'
}

export class LocalWhisperClient implements WhisperClient {
  private model: string

  constructor(opts: LocalWhisperOpts = {}) {
    this.model = opts.model ?? 'base.en'
  }

  async transcribe(audio: ArrayBuffer): Promise<string> {
    const tmp = path.join(os.tmpdir(), `cog-whisper-${randomBytes(6).toString('hex')}.webm`)
    fs.writeFileSync(tmp, Buffer.from(audio))
    try {
      // nodejs-whisper uses shelljs.exec('node ...') under the hood. In Electron
      // process.execPath is electron.exe, so shelljs's auto-detection of node
      // fails ("Unable to find a path to the node binary"). Resolve a real node
      // binary from PATH and tell shelljs about it before invoking the lib.
      const shell = await import('shelljs') as { default?: { config: { execPath: string | null }; which: (cmd: string) => string | null }; config?: { execPath: string | null }; which?: (cmd: string) => string | null }
      const sh = (shell.default ?? shell) as { config: { execPath: string | null }; which: (cmd: string) => string | null }
      if (!sh.config.execPath) {
        const found = sh.which('node')
        if (found) sh.config.execPath = String(found)
        else throw new Error('Local Whisper requires `node` on PATH (couldn\'t locate it). Install Node.js or use Cloud Whisper.')
      }

      const { nodewhisper } = await import('nodejs-whisper')
      const result = await nodewhisper(tmp, {
        modelName: this.model,
        autoDownloadModelName: this.model,
        removeWavFileAfterTranscription: true,
        withCuda: false,
        whisperOptions: { outputInText: true, outputInJson: false },
      } as Parameters<typeof nodewhisper>[1])
      return (typeof result === 'string' ? result : '').trim()
    } finally {
      try { fs.rmSync(tmp, { force: true }) } catch { /* best-effort */ }
    }
  }
}
