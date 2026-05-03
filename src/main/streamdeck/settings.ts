import { DEFAULT_STREAMDECK_SETTINGS, type StreamDeckSettings } from './types'

export interface SettingsIO {
  load(): Record<string, unknown>
  save(next: Record<string, unknown>): void
}

const KEY = 'streamdeck'

export function readStreamDeckSettings(io: SettingsIO): StreamDeckSettings {
  const all = io.load()
  const stored = (all[KEY] as Partial<StreamDeckSettings> | undefined) ?? {}
  return { ...DEFAULT_STREAMDECK_SETTINGS, ...stored }
}

export function writeStreamDeckSettings(io: SettingsIO, patch: Partial<StreamDeckSettings>): void {
  const all = io.load()
  const current = (all[KEY] as Partial<StreamDeckSettings> | undefined) ?? {}
  all[KEY] = { ...DEFAULT_STREAMDECK_SETTINGS, ...current, ...patch }
  io.save(all)
}
