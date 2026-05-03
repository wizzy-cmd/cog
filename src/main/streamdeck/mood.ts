import type { AgentStatus } from '../../shared/types'

// SVG file names in marketing/cogsworth/ that we use.
export const MOODS = {
  neutral: 'cogsworth-neutral.svg',
  thinking: 'cogsworth-thinking.svg',
  focused: 'cogsworth-focused.svg',
  dead: 'cogsworth-dead.svg',
  sleeping: 'cogsworth-sleeping.svg',
  alert: 'cogsworth-alert.svg',
  happy: 'cogsworth-happy.svg',
} as const

export function moodForStatus(status: AgentStatus): string {
  switch (status) {
    case 'idle': return MOODS.neutral
    case 'active': return MOODS.thinking
    case 'working': return MOODS.focused
    case 'disconnected': return MOODS.dead
  }
}
