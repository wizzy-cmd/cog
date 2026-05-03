import type { BridgeActions } from './bridge'
import type { VoiceCoordinator, VoiceState } from './voice-coordinator'

export interface ActionDeps {
  killAgentByName: (name: string) => Promise<void>
  focusAgent: (name: string) => void
  killAllAgents: () => Promise<void>
  openInbox: () => void
  openTrollbox: () => void
  openStalePanel: () => void
  markInboxRead: () => void
  markTrollboxRead: () => void
  loadPreset: (name: string) => Promise<void>
  voiceCoordinator: VoiceCoordinator
  writeToOrchestratorPty: (text: string) => boolean
  notifyToast: (message: string) => void
  showMainWindow: () => void
}

export function buildBridgeActions(deps: ActionDeps): BridgeActions & {
  onTranscript: (text: string) => void
  onVoiceState: (s: VoiceState) => void
  onVoiceError: (err: unknown) => void
} {
  return {
    onAgentTap: (name) => {
      deps.showMainWindow()
      deps.focusAgent(name)
    },
    onAgentHold: (name) => {
      void deps.killAgentByName(name)
    },
    onActionTap: (action) => {
      switch (action) {
        case 'voice':    void deps.voiceCoordinator.toggle(); break
        case 'inbox':    deps.showMainWindow(); deps.openInbox(); break
        case 'trollbox': deps.showMainWindow(); deps.openTrollbox(); break
        case 'stale':    deps.showMainWindow(); deps.openStalePanel(); break
        case 'panic':    /* tap = no-op (safety) */ break
      }
    },
    onActionHold: (action) => {
      switch (action) {
        case 'inbox':    deps.markInboxRead(); break
        case 'trollbox': deps.markTrollboxRead(); break
        case 'panic':    void deps.killAllAgents(); break
        case 'voice':    /* no hold action */ break
        case 'stale':    /* no hold action */ break
      }
    },
    onPresetTap: (name) => {
      void deps.loadPreset(name)
    },
    onTranscript: (text) => {
      const ok = deps.writeToOrchestratorPty(text + '\n')
      if (!ok) deps.notifyToast('No orchestrator running — voice transcript dropped.')
    },
    onVoiceState: (_s) => { /* could update LCD in the future */ },
    onVoiceError: (err) => { deps.notifyToast(`Whisper error: ${(err as Error).message}`) },
  }
}
