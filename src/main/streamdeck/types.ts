import type { AgentState } from '../../shared/types'

export type WhisperBackend = 'cloud' | 'local' | 'disabled'

export interface StreamDeckSettings {
  enabled: boolean
  whisperBackend: WhisperBackend
  openaiApiKey?: string
}

export const DEFAULT_STREAMDECK_SETTINGS: StreamDeckSettings = {
  enabled: true,
  whisperBackend: 'cloud',
}

export interface KeyDescriptor {
  index: number              // 0..14
  kind: 'agent' | 'action' | 'preset' | 'empty'
  agent?: AgentState         // present when kind === 'agent'
  action?: 'voice' | 'inbox' | 'trollbox' | 'stale' | 'panic'
  preset?: { name: string; agentCount: number }
  empty?: 'orchestrator-missing' | 'no-worker' | 'no-preset'
}

export interface KeyVisualState {
  faceSvg: string            // e.g. 'cogsworth-focused.svg'
  tint: 'none' | 'red' | 'orange' | 'green' | 'grey'
  badge?: string             // e.g. '3' for unread count
  label?: string             // e.g. 'TEAM 1', 'VOICE'
  pulsing?: boolean
}
