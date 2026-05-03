import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VoiceCoordinator } from '../../src/main/streamdeck/voice-coordinator'
import type { WhisperClient } from '../../src/main/streamdeck/whisper-client'

const fakeBuffer = (n: number) => new ArrayBuffer(n)

describe('VoiceCoordinator', () => {
  let sendStart: ReturnType<typeof vi.fn>
  let sendStop: ReturnType<typeof vi.fn>
  let onTranscript: ReturnType<typeof vi.fn>
  let onState: ReturnType<typeof vi.fn>
  let whisper: WhisperClient
  let coord: VoiceCoordinator

  beforeEach(() => {
    sendStart = vi.fn()
    sendStop = vi.fn()
    onTranscript = vi.fn()
    onState = vi.fn()
    whisper = { transcribe: vi.fn(async () => 'transcribed text') }
    coord = new VoiceCoordinator({ sendStart, sendStop, onTranscript, onState, getWhisper: () => whisper })
  })

  it('first toggle starts recording', async () => {
    await coord.toggle()
    expect(sendStart).toHaveBeenCalled()
    expect(coord.state).toBe('recording')
  })

  it('second toggle stops, transcribes, fires onTranscript', async () => {
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(100))
    await stopped
    expect(sendStop).toHaveBeenCalled()
    expect(whisper.transcribe).toHaveBeenCalled()
    expect(onTranscript).toHaveBeenCalledWith('transcribed text')
    expect(coord.state).toBe('idle')
  })

  it('emits state transitions', async () => {
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(100))
    await stopped
    const states = onState.mock.calls.map(c => c[0])
    expect(states).toEqual(['recording', 'transcribing', 'idle'])
  })

  it('drops empty audio buffers without calling whisper', async () => {
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(0))
    await stopped
    expect(whisper.transcribe).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(coord.state).toBe('idle')
  })

  it('reports whisper failures via onError without leaving state stuck', async () => {
    const err = new Error('boom')
    ;(whisper.transcribe as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)
    const onError = vi.fn()
    coord = new VoiceCoordinator({ sendStart, sendStop, onTranscript, onState, getWhisper: () => whisper, onError })
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(100))
    await stopped
    expect(onError).toHaveBeenCalledWith(err)
    expect(coord.state).toBe('idle')
  })
})
