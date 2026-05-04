// Renderer-side singleton. Initialized once from main.tsx. Listens for
// voice:start / voice:stop IPC from main, captures mic via MediaRecorder,
// posts the assembled audio buffer back via voice:audio.

interface ElectronAPIMin {
  onVoiceStart(cb: () => void): () => void
  onVoiceStop(cb: () => void): () => void
  sendVoiceAudio(audio: ArrayBuffer): void
}

declare global {
  interface Window { electronAPI: ElectronAPIMin & Record<string, unknown> }
}

export function mountVoiceRecorder(): () => void {
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let stream: MediaStream | null = null

  const stopAndShip = async () => {
    if (!recorder || recorder.state === 'inactive') return
    await new Promise<void>((resolve) => {
      recorder!.addEventListener('stop', () => resolve(), { once: true })
      recorder!.stop()
    })
    stream?.getTracks().forEach(t => t.stop())
    stream = null

    const blob = new Blob(chunks, { type: 'audio/webm' })
    chunks = []
    const buf = await blob.arrayBuffer()
    if (buf.byteLength > 0) {
      window.electronAPI.sendVoiceAudio(buf)
    }
    recorder = null
  }

  const startCapture = async () => {
    console.log('[voice-recorder] startCapture: requesting mic')
    if (recorder) return  // already recording
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('[voice-recorder] startCapture: got stream, starting MediaRecorder')
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      })
      recorder.start()
    } catch (err) {
      // Mic permission denied or device error. Send empty buffer so the bridge
      // can surface a "mic permission needed" toast.
      console.warn('[voice-recorder] getUserMedia failed:', err)
      window.electronAPI.sendVoiceAudio(new ArrayBuffer(0))
    }
  }

  console.log('[voice-recorder] mounted, waiting for voice:start IPC')
  const offStart = window.electronAPI.onVoiceStart(() => {
    console.log('[voice-recorder] received voice:start IPC')
    void startCapture()
  })
  const offStop = window.electronAPI.onVoiceStop(() => {
    console.log('[voice-recorder] received voice:stop IPC')
    void stopAndShip()
  })

  return () => {
    offStart()
    offStop()
    void stopAndShip()
  }
}
