import os from 'node:os'

// ── Spawn governor ──────────────────────────────────────────────────────────
// Serializes agent spawns so a burst (e.g. an approved team of 5+) can never
// fire concurrently and crash the Electron app — the documented failure mode
// where bursting ~5 spawns in one propose_team approval takes down the whole
// fleet. safeSend is only a catch-net; this prevents the burst at the source.
//
// Each spawn waits for (1) a minimum stagger gap since the previous spawn and
// (2) capacity: live agent count under a ceiling AND enough free RAM. If
// capacity stays unavailable past maxWaitMs, the spawn proceeds anyway with a
// warning — a user-approved spawn is never silently dropped.
//
// All thresholds are env-configurable (COG_MAX_AGENTS, COG_MIN_FREE_MEM_MB,
// COG_SPAWN_STAGGER_MS, COG_SPAWN_MAX_WAIT_MS, COG_SPAWN_POLL_MS).

export interface SpawnGovernorConfig {
  maxAgents: number // ceiling on concurrent live agents before throttling
  minFreeMemMb: number // require at least this much free RAM before a spawn
  staggerMs: number // minimum gap between consecutive spawns
  maxWaitMs: number // cap on how long to wait for capacity before spawning anyway
  pollMs: number // capacity re-check interval while throttled
}

export interface ThrottleInfo {
  reason: string
  liveAgents: number
  freeMemMb: number
  queued: number
  waitedMs: number
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function defaultSpawnGovernorConfig(): SpawnGovernorConfig {
  return {
    maxAgents: envInt('COG_MAX_AGENTS', 11),
    minFreeMemMb: envInt('COG_MIN_FREE_MEM_MB', 500),
    staggerMs: envInt('COG_SPAWN_STAGGER_MS', 2000),
    maxWaitMs: envInt('COG_SPAWN_MAX_WAIT_MS', 90000),
    pollMs: envInt('COG_SPAWN_POLL_MS', 1500),
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class SpawnGovernor {
  private chain: Promise<unknown> = Promise.resolve()
  private lastSpawnAt = 0
  private queued = 0

  constructor(
    private readonly cfg: SpawnGovernorConfig,
    private readonly getLiveAgentCount: () => number,
    private readonly onThrottle?: (info: ThrottleInfo) => void
  ) {}

  private freeMemMb(): number {
    return Math.round(os.freemem() / (1024 * 1024))
  }

  // Run a spawn through the serialized, gated queue. Returns the spawn fn's
  // result. Spawns execute strictly one at a time, in call order.
  run<T>(spawnFn: () => T): Promise<T> {
    this.queued++
    const task = this.chain.then(async () => {
      try {
        await this.awaitStagger()
        await this.awaitCapacity()
        this.lastSpawnAt = Date.now()
        return spawnFn()
      } finally {
        this.queued--
      }
    })
    // Keep the chain alive even if a spawn throws, so later spawns still run.
    this.chain = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  private async awaitStagger(): Promise<void> {
    if (this.lastSpawnAt === 0) return
    const elapsed = Date.now() - this.lastSpawnAt
    if (elapsed < this.cfg.staggerMs) await delay(this.cfg.staggerMs - elapsed)
  }

  private async awaitCapacity(): Promise<void> {
    const start = Date.now()
    for (;;) {
      const liveAgents = this.getLiveAgentCount()
      const freeMemMb = this.freeMemMb()
      const overCount = liveAgents >= this.cfg.maxAgents
      const lowMem = freeMemMb < this.cfg.minFreeMemMb
      if (!overCount && !lowMem) return

      const waitedMs = Date.now() - start
      if (waitedMs >= this.cfg.maxWaitMs) {
        // Never permanently drop a user-approved spawn — proceed with a warning.
        this.onThrottle?.({
          reason: `proceeding after ${Math.round(waitedMs / 1000)}s wait (${overCount ? 'agent ceiling' : 'low memory'})`,
          liveAgents,
          freeMemMb,
          queued: this.queued,
          waitedMs,
        })
        return
      }

      this.onThrottle?.({
        reason: overCount
          ? `agent ceiling (${liveAgents}/${this.cfg.maxAgents})`
          : `low memory (${freeMemMb}MB < ${this.cfg.minFreeMemMb}MB)`,
        liveAgents,
        freeMemMb,
        queued: this.queued,
        waitedMs,
      })
      await delay(this.cfg.pollMs)
    }
  }
}
