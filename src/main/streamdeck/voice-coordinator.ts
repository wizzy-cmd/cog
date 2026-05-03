import type { WhisperClient } from './whisper-client'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

export interface VoiceCoordinatorOpts {
  sendStart: () => void
  sendStop: () => void
  onTranscript: (text: string) => void
  onState: (state: VoiceState) => void
  onError?: (err: unknown) => void
  getWhisper: () => WhisperClient | null
}

export class VoiceCoordinator {
  state: VoiceState = 'idle'
  private opts: VoiceCoordinatorOpts
  private pendingStop: { resolve: () => void } | null = null

  constructor(opts: VoiceCoordinatorOpts) {
    this.opts = opts
  }

  async toggle(): Promise<void> {
    if (this.state === 'idle') {
      this.setState('recording')
      this.opts.sendStart()
      return
    }
    if (this.state === 'recording') {
      this.opts.sendStop()
      // Wait for handleAudio to fire (or never — if the renderer is gone,
      // the bridge will dispose us cleanly on shutdown)
      await new Promise<void>((resolve) => { this.pendingStop = { resolve } })
      return
    }
    // 'transcribing' — ignore further toggles until done
  }

  handleAudio(audio: ArrayBuffer): void {
    if (this.state !== 'recording') return
    void this.processAudio(audio)
  }

  private async processAudio(audio: ArrayBuffer): Promise<void> {
    if (audio.byteLength === 0) {
      this.setState('idle')
      this.pendingStop?.resolve()
      this.pendingStop = null
      return
    }
    this.setState('transcribing')
    const whisper = this.opts.getWhisper()
    if (!whisper) {
      this.setState('idle')
      this.pendingStop?.resolve()
      this.pendingStop = null
      return
    }
    try {
      const text = await whisper.transcribe(audio)
      if (text.length > 0) this.opts.onTranscript(text)
    } catch (err) {
      this.opts.onError?.(err)
    } finally {
      this.setState('idle')
      this.pendingStop?.resolve()
      this.pendingStop = null
    }
  }

  private setState(next: VoiceState): void {
    this.state = next
    this.opts.onState(next)
  }
}
