import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Track } from '../types'
import {
  ART_PX,
  ART_SCRIPT,
  INFO_SCRIPT,
  SAMPLE_SCRIPT,
  artCells,
  beatMs,
  clock,
  explainFailure,
  isPixels,
  parseInfo,
  BOOMBOX_COLS,
  BOOMBOX_NOTE_COUNT,
  BOOMBOX_ROWS,
  boomboxCells,
  noteColor,
  progressBar,
} from './lib'

const track = atom({ plugin: 'clauisc', key: 'track' } as const, null)
const art = atom({ plugin: 'clauisc', key: 'art' } as const, null)
const isHidden = atom({ plugin: 'clauisc', key: 'isHidden' } as const, false)
const style = atom({ plugin: 'clauisc', key: 'style' } as const, 'blocks')
const problem = atom({ plugin: 'clauisc', key: 'problem' } as const, null)

const ART_FILE = '/tmp/clauisc-art'
const POLL_MS = 2000
// An absolute path: apps that start Claude Code may give it a bare PATH.
const OSASCRIPT = '/usr/bin/osascript'
// Long enough for the person to answer macOS's first "control Music?" prompt,
// which holds osascript until it is answered.
const INFO_TIMEOUT_MS = 60000

function beatColors(): number[] {
  return Array.from({ length: BOOMBOX_NOTE_COUNT }, () => noteColor(Math.random()))
}

// Module state for polling and the animation only; what the band draws lives in $.state.
const live = {
  current: null as Track | null,
  artFor: null as string | null,
  tones: beatColors(),
  hasBoombox: false,
  bandId: null as string | null,
  isPolling: false,
  poller: null as Timer | null,
  // Diagnostics for /nowplaying status.
  polls: 0,
  renders: 0,
  surface: null as string | null,
  lastExit: null as number | null,
  lastStdout: '',
  lastStderr: '',
  lastError: null as string | null,
  artStatus: 'not loaded',
}

async function loadArt($: EngineInterface, id: string) {
  let pixels: string | null = null
  try {
    const dumped = await $.process.run([OSASCRIPT, '-e', ART_SCRIPT, ART_FILE], { timeoutMs: 8000 })
    if (dumped.stdout.trim() === 'ok') {
      const sampled = await $.process.run(
        [OSASCRIPT, '-l', 'JavaScript', '-e', SAMPLE_SCRIPT, ART_FILE, String(ART_PX), String(ART_PX)],
        { timeoutMs: 8000 },
      )
      const hex = sampled.stdout.trim()
      if (isPixels(hex)) pixels = hex
      live.artStatus = pixels ? 'loaded' : `sampling failed (exit ${sampled.exitCode}): ${sampled.stderr.trim().slice(0, 160)}`
    } else {
      live.artStatus = `no artwork from Music (${dumped.stdout.trim() || dumped.stderr.trim().slice(0, 160)})`
    }
  } catch (error) {
    // No artwork is drawn as a placeholder.
    live.artStatus = `could not run osascript: ${String(error).slice(0, 160)}`
  }
  if (live.artFor === id) await update($, art, () => pixels)
}

async function poll($: EngineInterface) {
  if (live.isPolling) return
  live.isPolling = true
  live.polls += 1
  try {
    const ran = await $.process.run([OSASCRIPT, '-e', INFO_SCRIPT], { timeoutMs: INFO_TIMEOUT_MS })
    live.lastExit = ran.exitCode
    live.lastStdout = ran.stdout.trim().slice(0, 300)
    live.lastStderr = ran.stderr.trim().slice(0, 300)
    live.lastError = null
    const now = ran.exitCode === 0 ? parseInfo(ran.stdout) : null
    live.current = now
    await update($, problem, () => (ran.exitCode === 0 ? null : explainFailure(ran.stderr)))
    await update($, track, () => now)
    if (now && now.id !== live.artFor) {
      live.artFor = now.id
      await update($, art, () => null)
      await loadArt($, now.id)
    }
    if (!now) live.artFor = null
  } catch (error) {
    // osascript could not start or ran past the timeout: say so and keep trying.
    live.lastError = String(error).slice(0, 300)
    await update($, problem, () => `Could not run osascript: ${live.lastError}`)
  } finally {
    live.isPolling = false
  }
}

function statusReport(): string {
  const t = live.current
  return [
    'Clauisc status',
    `- polls: ${live.polls}, last osascript exit: ${live.lastExit ?? 'none yet'}`,
    `- last error: ${live.lastError ?? 'none'}`,
    `- stdout: ${JSON.stringify(live.lastStdout)}`,
    `- stderr: ${JSON.stringify(live.lastStderr)}`,
    `- track: ${t ? `${t.isPlaying ? 'playing' : 'paused'} "${t.name}" by ${t.artist || 'unknown'} (bpm ${t.bpm})` : 'none'}`,
    `- artwork: ${live.artStatus}`,
    `- band drawn: ${live.renders} times, surface ${live.surface ?? 'never asked'}`,
  ].join('\n')
}

function bop($: EngineInterface) {
  $.clock.after(beatMs(live.current?.bpm ?? 0, Math.random()), () => {
    if (live.current?.isPlaying && live.bandId) {
      live.tones = beatColors()
      if (live.hasBoombox) {
        $.ui
          .blit({ requestId: live.bandId, key: 'boombox', cells: boomboxCells(live.tones) })
          .catch(() => undefined)
      }
    }
    bop($)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nowplaying',
      description: 'Toggle the Apple Music band; "ascii" or "blocks" switches the cover style, "status" explains what it sees',
    })
    void poll($)
    live.poller?.cancel()
    live.poller = $.clock.every(POLL_MS, () => void poll($))
    bop($)

    return next(e)
  })

  on('command.run', { command: 'nowplaying' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'status') {
      await poll($)
      return { text: statusReport() }
    }
    if (arg === 'ascii' || arg === 'blocks') {
      await update($, style, () => arg)
      await update($, isHidden, () => false)
      return { text: `Now playing: cover drawn as ${arg}.` }
    }
    const hidden = await update($, isHidden, was => !was)
    return { text: hidden ? 'Now playing band hidden.' : 'Now playing band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    live.renders += 1
    live.surface = e.surface
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const t = await read($, track)
    const cols = e.props.bodyColumns

    if (t === null) {
      const why = await read($, problem)
      if (!why) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box justifyContent="flex-end" width={cols}>
          <Text color="#d97757" wrap="wrap">
            ♪ Clauisc: {why}
          </Text>
        </Box>
      )
    }

    const status = t.isPlaying ? '▶' : '⏸'
    if (e.surface !== 'terminal') {
      // Only the terminal draws Rasters: elsewhere the band is one line of text.
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box justifyContent="flex-end" width={cols}>
          <Text wrap="truncate-end">
            {status} {t.name}{t.artist ? ` · ${t.artist}` : ''}
          </Text>
        </Box>
      )
    }

    live.bandId = e.requestId
    const { Box, Text, Raster } = $.ui.resolve(e)
    const artSize = e.props.maxRows >= 8 && cols >= 70 ? 16 : 8
    const artRows = artSize / 2
    // The boombox joins when the band has room for it beside 16 columns of text.
    const hasBoombox = e.props.maxRows >= BOOMBOX_ROWS && cols >= artSize + BOOMBOX_COLS + 6 + 16
    live.hasBoombox = hasBoombox
    const textCols = Math.max(0, Math.min(34, cols - artSize - 4 - (hasBoombox ? BOOMBOX_COLS + 2 : 0)))
    const time = t.duration > 0 ? `${clock(t.position)} / ${clock(t.duration)}` : clock(t.position)

    if (textCols < 12) {
      return (
        <Box justifyContent="flex-end" width={cols}>
          <Text wrap="truncate-end">
            {status} {t.name}{t.artist ? ` · ${t.artist}` : ''}
          </Text>
        </Box>
      )
    }

    const pixels = await read($, art)
    const cover = artCells(pixels, artSize, await read($, style))

    return (
      <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end" width={cols}>
        <Raster key="cover" columns={artSize} rows={artRows} cells={cover} />
        <Box flexDirection="column" width={textCols} marginLeft={2} height={artRows} justifyContent="center">
          <Text bold wrap="truncate-end">{t.name}</Text>
          {t.artist ? <Text wrap="truncate-end">{t.artist}</Text> : null}
          {t.album && artRows > 3 ? <Text dimColor wrap="truncate-end">{t.album}</Text> : null}
          <Text dimColor wrap="truncate-end">
            {status} {time}
          </Text>
          {artRows > 4 ? (
            <Text color="#d97757">{progressBar(t.position, t.duration, textCols)}</Text>
          ) : null}
        </Box>
        {hasBoombox ? (
          <Box marginLeft={2}>
            <Raster
              key="boombox"
              columns={BOOMBOX_COLS}
              rows={BOOMBOX_ROWS}
              cells={boomboxCells(t.isPlaying ? live.tones : null)}
            />
          </Box>
        ) : null}
      </Box>
    )
  })
}
