import { useEffect, useState } from 'react'

interface StreamDeckSettings {
  enabled: boolean
  whisperBackend: 'cloud' | 'local' | 'disabled'
  openaiApiKey?: string
}

export function StreamDeckTab(): JSX.Element {
  const [settings, setSettings] = useState<StreamDeckSettings>({ enabled: true, whisperBackend: 'cloud' })
  const [showKey, setShowKey] = useState(false)
  const [connection, setConnection] = useState<'connected' | 'disconnected' | 'unknown'>('unknown')

  useEffect(() => {
    void window.electronAPI.getSettings().then((all: Record<string, unknown>) => {
      const s = (all.streamdeck as StreamDeckSettings | undefined)
      if (s) setSettings(prev => ({ ...prev, ...s }))
    })
    void window.electronAPI.getStreamDeckStatus?.().then((s: 'connected' | 'disconnected') => setConnection(s))
  }, [])

  const update = async (patch: Partial<StreamDeckSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    await window.electronAPI.setSetting('streamdeck', next)
  }

  return (
    <div className="settings-tab streamdeck-tab">
      <h2>Stream Deck</h2>

      <label className="settings-row">
        <input type="checkbox" checked={settings.enabled}
               onChange={e => void update({ enabled: e.target.checked })} />
        Enable Stream Deck integration
      </label>

      <fieldset className="settings-row">
        <legend>Voice transcription</legend>
        {(['cloud', 'local', 'disabled'] as const).map(opt => (
          <label key={opt}>
            <input type="radio" name="whisper" value={opt}
                   checked={settings.whisperBackend === opt}
                   onChange={() => void update({ whisperBackend: opt })} />
            {opt === 'cloud' ? 'Cloud (OpenAI Whisper)'
              : opt === 'local' ? 'Local (Whisper.cpp)'
              : 'Disabled'}
          </label>
        ))}
      </fieldset>

      {settings.whisperBackend === 'cloud' && (
        <label className="settings-row">
          OpenAI API key
          <input type={showKey ? 'text' : 'password'}
                 value={settings.openaiApiKey ?? ''}
                 onChange={e => void update({ openaiApiKey: e.target.value })}
                 placeholder="sk-…" />
          <button type="button" onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide' : 'Show'}</button>
        </label>
      )}

      <div className="settings-row">
        Connection: <strong>{connection}</strong>
        <button type="button" onClick={() => window.electronAPI.reconnectStreamDeck?.()}>
          Reconnect
        </button>
      </div>
    </div>
  )
}
