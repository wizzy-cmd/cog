// One-time setup for local Whisper: ensure the model is downloaded and
// whisper.cpp is built. Streams progress to a callback so the renderer can
// show a progress bar in Settings.
//
// We bypass nodejs-whisper's autoDownloadModel for the build phase because
// it uses shelljs.exec() synchronously and we can't stream stdout from there.
// Instead we spawn cmake directly via child_process, parse `[NN%]` lines, and
// feed progress events. After this succeeds, nodewhisper(...) sees the
// artifacts in place and skips its own setup, going straight to transcription.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type LocalPrepareStage = 'model' | 'configure' | 'build' | 'ready' | 'error'

export interface LocalPrepareEvent {
  stage: LocalPrepareStage
  percent: number      // 0..100 (overall, weighted across stages)
  detail?: string      // e.g. 'Building CXX object ggml/...' or error message
}

const NODEJS_WHISPER_DIR = path.join(
  process.cwd(),
  'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp',
)
const MODELS_DIR = path.join(NODEJS_WHISPER_DIR, 'models')
const BUILD_DIR = path.join(NODEJS_WHISPER_DIR, 'build')

// nodejs-whisper expects build/bin/Release/whisper-cli.exe (Visual Studio
// multi-config layout). On a system that picks MinGW/MSYS or another
// single-config CMake generator, the binary lands at build/bin/whisper-cli.exe
// instead. We track BOTH and mirror after a successful build.
const WHISPER_CLI_EXPECTED = process.platform === 'win32'
  ? path.join(BUILD_DIR, 'bin', 'Release', 'whisper-cli.exe')
  : path.join(BUILD_DIR, 'bin', 'whisper-cli')
const WHISPER_CLI_FALLBACK = process.platform === 'win32'
  ? path.join(BUILD_DIR, 'bin', 'whisper-cli.exe')
  : null

const MODEL_FILE = (model: string) => path.join(MODELS_DIR, `ggml-${model}.bin`)

const BUILD_PERCENT_RE = /^\s*\[\s*(\d+)%\]/

export function isLocalWhisperReady(model = 'base.en'): boolean {
  return fs.existsSync(MODEL_FILE(model)) && fs.existsSync(WHISPER_CLI_EXPECTED)
}

/**
 * If the build produced whisper-cli at build/bin/ instead of build/bin/Release/
 * (single-config CMake generator like MinGW/MSYS/Ninja), copy the binary and
 * its sibling DLLs into the Release subdir so nodejs-whisper can find it.
 */
function mirrorBinaryToReleaseDir(): boolean {
  if (process.platform !== 'win32' || !WHISPER_CLI_FALLBACK) return false
  if (fs.existsSync(WHISPER_CLI_EXPECTED)) return true
  if (!fs.existsSync(WHISPER_CLI_FALLBACK)) return false

  const srcDir = path.dirname(WHISPER_CLI_FALLBACK)
  const dstDir = path.dirname(WHISPER_CLI_EXPECTED)
  fs.mkdirSync(dstDir, { recursive: true })

  // Copy whisper-cli.exe + every *.dll alongside it (whisper-cli depends on
  // ggml/whisper DLLs being on the same dir or PATH).
  const items = fs.readdirSync(srcDir)
  for (const name of items) {
    if (name === 'whisper-cli.exe' || name.endsWith('.dll')) {
      fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name))
    }
  }
  return fs.existsSync(WHISPER_CLI_EXPECTED)
}

/**
 * Run the missing setup steps for local Whisper, streaming progress.
 * Returns when everything is in place. Idempotent: if already ready, returns
 * immediately with stage='ready', percent=100.
 */
export async function prepareLocalWhisper(
  onProgress: (e: LocalPrepareEvent) => void,
  model = 'base.en',
): Promise<void> {
  if (isLocalWhisperReady(model)) {
    onProgress({ stage: 'ready', percent: 100 })
    return
  }

  // Step 1: model download (10% of overall progress)
  if (!fs.existsSync(MODEL_FILE(model))) {
    onProgress({ stage: 'model', percent: 0, detail: `Downloading ggml-${model}.bin (~150MB)…` })
    await runCommand({
      cmd: process.platform === 'win32' ? 'cmd.exe' : 'bash',
      args: process.platform === 'win32'
        ? ['/c', 'download-ggml-model.cmd', model]
        : ['./download-ggml-model.sh', model],
      cwd: MODELS_DIR,
      onLine: (line) => {
        // The download script doesn't expose a clean percentage; just relay
        // the latest line as a status string.
        onProgress({ stage: 'model', percent: 5, detail: line.slice(0, 120) })
      },
    })
    onProgress({ stage: 'model', percent: 10, detail: 'Model downloaded' })
  } else {
    onProgress({ stage: 'model', percent: 10, detail: 'Model already present' })
  }

  // Step 2: cmake configure (10–20% of overall progress)
  if (!fs.existsSync(WHISPER_CLI)) {
    onProgress({ stage: 'configure', percent: 10, detail: 'Configuring CMake…' })
    await runCommand({
      cmd: 'cmake',
      args: ['-B', 'build', '-DCMAKE_BUILD_TYPE=Release'],
      cwd: NODEJS_WHISPER_DIR,
      onLine: () => { /* configure output is verbose; just keep the bar at 10–20% */ },
    })
    onProgress({ stage: 'configure', percent: 20, detail: 'CMake configured' })

    // Step 3: cmake build (20–100% of overall progress, parsed from [NN%] lines)
    onProgress({ stage: 'build', percent: 20, detail: 'Compiling whisper.cpp…' })
    await runCommand({
      cmd: 'cmake',
      args: ['--build', 'build', '--config', 'Release'],
      cwd: NODEJS_WHISPER_DIR,
      onLine: (line) => {
        const m = BUILD_PERCENT_RE.exec(line)
        if (m) {
          const cmakePercent = Number(m[1])
          // Map 0–100% of cmake build to 20–100% of overall progress.
          const overall = 20 + Math.floor(cmakePercent * 0.8)
          onProgress({ stage: 'build', percent: overall, detail: line.trim().slice(0, 120) })
        }
      },
    })
  }

  if (!isLocalWhisperReady(model)) {
    // Maybe the build produced whisper-cli at build/bin/ instead of
    // build/bin/Release/ (MinGW/Ninja single-config generators do this).
    // Mirror it into the expected location.
    onProgress({ stage: 'build', percent: 100, detail: 'Mirroring binary to Release/ for nodejs-whisper compatibility…' })
    const mirrored = mirrorBinaryToReleaseDir()
    if (!mirrored) {
      throw new Error('Local Whisper setup ran but whisper-cli.exe was not produced. Check the dev console for CMake errors.')
    }
  }
  onProgress({ stage: 'ready', percent: 100, detail: 'Local Whisper ready' })
}

interface CommandOpts {
  cmd: string
  args: string[]
  cwd: string
  onLine: (line: string) => void
}

function runCommand(opts: CommandOpts): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      shell: process.platform === 'win32', // cmd builtins (e.g. .cmd files) need a shell on Windows
      windowsHide: true,
    })
    let stderr = ''
    const handleData = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.length === 0) continue
        opts.onLine(line)
      }
    }
    child.stdout?.on('data', handleData)
    child.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      stderr += s
      handleData(chunk)
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${opts.cmd} exited ${code}: ${stderr.slice(-500) || '(no stderr)'}`))
    })
  })
}
