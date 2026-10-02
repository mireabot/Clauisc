import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Track } from '../types'
import {
  BAND_ROWS,
  INFO_SCRIPT,
  NOW_SCRIPT,
  NOTES_COLS,
  RING_COLS,
  beatMs,
  explainFailure,
  notesCells,
  parseInfo,
  parseNowPlaying,
  riseNotes,
  ringCells,
} from './lib'
import type { FloatingNote } from './lib'

const track = atom({ plugin: 'clauisc', key: 'track' } as const, null)
const isHidden = atom({ plugin: 'clauisc', key: 'isHidden' } as const, false)
const problem = atom({ plugin: 'clauisc', key: 'problem' } as const, null)

const POLL_MS = 2000
// An absolute path: apps that start Claude Code may give it a bare PATH.
const OSASCRIPT = '/usr/bin/osascript'
// Long enough for the person to answer macOS's first "control Music?" prompt,
// which holds osascript until it is answered.
const INFO_TIMEOUT_MS = 60000

// Spacing in terminal columns (a column is about 8-9 px wide).
const GAP = 1 // between components
const TEXT_MAX = 36 // widest the centered title/artist stack gets

// Module state for polling and the animation only; what the band draws lives in $.state.
const live = {
  current: null as Track | null,
  polledAt: 0,
  source: 'none yet',
  notes: [] as FloatingNote[],
  bandId: null as string | null,
  hasFrame: false,
  isPolling: false,
  poller: null as Timer | null,
  // Diagnostics for /nowplaying status.
  polls: 0,
  ticks: 0,
  beats: 0,
  watchdogPolls: 0,
  renders: 0,
  surface: null as string | null,
  lastExit: null as number | null,
  nowPlayingExit: null as number | null,
  nowPlayingStdout: '',
  nowPlayingStderr: '',
  lastStdout: '',
  lastStderr: '',
  lastError: null as string | null,
}

/** System Now Playing first: it describes streamed songs that Music's AppleScript cannot. */
async function pollNowPlaying($: EngineInterface): Promise<boolean> {
  const ran = await $.process.run(
    [OSASCRIPT, '-l', 'JavaScript', '-e', NOW_SCRIPT],
    { timeoutMs: INFO_TIMEOUT_MS },
  )
  live.nowPlayingExit = ran.exitCode
  live.nowPlayingStdout = ran.stdout.trim().slice(0, 300)
  live.nowPlayingStderr = ran.stderr.trim().slice(0, 300)
  const found = ran.exitCode === 0 ? parseNowPlaying(ran.stdout) : null
  if (!found) return false

  live.source = 'system Now Playing'
  live.current = found.track
  await update($, problem, () => null)
  await update($, track, () => found.track)
  return true
}

/** Music's own AppleScript: the fallback when Now Playing is unreadable. */
async function pollMusic($: EngineInterface) {
  const ran = await $.process.run([OSASCRIPT, '-e', INFO_SCRIPT], { timeoutMs: INFO_TIMEOUT_MS })
  live.source = 'Music AppleScript'
  live.lastExit = ran.exitCode
  live.lastStdout = ran.stdout.trim().slice(0, 300)
  live.lastStderr = ran.stderr.trim().slice(0, 300)
  const now = ran.exitCode === 0 ? parseInfo(ran.stdout) : null
  live.current = now
  await update($, problem, () => (ran.exitCode === 0 ? null : explainFailure(ran.stderr)))
  await update($, track, () => now)
}

async function poll($: EngineInterface) {
  if (live.isPolling) return
  live.isPolling = true
  live.polls += 1
  try {
    if (!(await pollNowPlaying($))) await pollMusic($)
    live.polledAt = await $.clock.now()
    live.lastError = null
  } catch (error) {
    // osascript could not start or ran past the timeout: say so and keep trying.
    live.polledAt = await $.clock.now()
    live.lastError = String(error).slice(0, 300)
    await update($, problem, () => `Could not run osascript: ${live.lastError}`)
  } finally {
    live.isPolling = false
  }
}

async function statusReport($: EngineInterface): Promise<string> {
  const t = live.current
  const age = live.polledAt ? Math.round(((await $.clock.now()) - live.polledAt) / 1000) : null
  return [
    'Clauisc status',
    `- source: ${live.source}`,
    `- polls: ${live.polls} (timer ticks ${live.ticks}, beats ${live.beats}, backup polls ${live.watchdogPolls}), last ${age === null ? 'never' : `${age}s ago`}`,
    `- last error: ${live.lastError ?? 'none'}`,
    `- Now Playing: exit ${live.nowPlayingExit ?? 'not run'}, stdout ${JSON.stringify(live.nowPlayingStdout)}, stderr ${JSON.stringify(live.nowPlayingStderr)}`,
    `- Music AppleScript: exit ${live.lastExit ?? 'not run'}, stdout ${JSON.stringify(live.lastStdout)}, stderr ${JSON.stringify(live.lastStderr)}`,
    `- track: ${t ? `${t.isPlaying ? 'playing' : 'paused'} "${t.name}" by ${t.artist || 'unknown'} at ${Math.round(t.position)}/${Math.round(t.duration)}s (bpm ${t.bpm})` : 'none'}`,
    `- band drawn: ${live.renders} times, surface ${live.surface ?? 'never asked'}`,
  ].join('\n')
}

/** How far through the track, counting the time since the last poll while playing. */
function progress(t: Track, now: number): number {
  if (t.duration <= 0) return 0
  const since = t.isPlaying && live.polledAt ? (now - live.polledAt) / 1000 : 0
  return (t.position + since) / t.duration
}

function beat($: EngineInterface) {
  $.clock.after(beatMs(live.current?.bpm ?? 0, Math.random()), () => {
    void (async () => {
      live.beats += 1
      const now = await $.clock.now()
      // A backup for the poll timer: if it has gone quiet, ask Music from here.
      if (!live.isPolling && now - live.polledAt > POLL_MS * 2) {
        live.watchdogPolls += 1
        void poll($)
      }
      const t = live.current
      if (t && live.bandId && live.hasFrame) {
        // Playing, a new note starts each beat; paused, the last ones float away.
        live.notes = riseNotes(live.notes, Math.random, t.isPlaying)
        const requestId = live.bandId
        $.ui.blit({ requestId, key: 'notes', cells: notesCells(live.notes) }).catch(() => undefined)
        $.ui
          .blit({ requestId, key: 'ring', cells: ringCells(progress(t, now), t.isPlaying) })
          .catch(() => undefined)
      }
    })().finally(() => beat($))
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nowplaying',
      description: 'Toggle the Apple Music band; "/nowplaying status" explains what it sees',
    })
    void poll($)
    live.poller?.cancel()
    live.poller = $.clock.every(POLL_MS, () => {
      live.ticks += 1
      void poll($)
    })
    beat($)

    return next(e)
  })

  on('command.run', { command: 'nowplaying' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'status') {
      await poll($)
      return { text: await statusReport($) }
    }
    const hidden = await update($, isHidden, was => !was)
    return { text: hidden ? 'Clauisc band hidden.' : 'Clauisc band shown.' }
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
    // The boombox body: top edge, a side each way and the rounded bottom, then the notes.
    const fixed = 2 + GAP + GAP + RING_COLS + GAP + GAP + NOTES_COLS
    const textCols = Math.min(TEXT_MAX, cols - fixed - 1)
    const hasFrame = e.surface === 'terminal' && e.props.maxRows >= BAND_ROWS + 2 && textCols >= 10
    live.hasFrame = hasFrame

    if (!hasFrame) {
      // Too small, or a surface without Rasters: one line of text.
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
    const inner = GAP + textCols + GAP + RING_COLS + GAP
    const ring = ringCells(progress(t, await $.clock.now()), t.isPlaying)
    const side = (
      <Box flexDirection="column">
        {Array.from({ length: BAND_ROWS }, () => (
          <Text dimColor>|</Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-start" width={cols}>
        <Box flexDirection="column">
          <Text dimColor>{` ${'_'.repeat(inner)}`}</Text>
          <Box flexDirection="row">
            {side}
            <Box
              flexDirection="column"
              justifyContent="center"
              alignItems="center"
              width={textCols}
              height={BAND_ROWS}
              marginLeft={GAP}
            >
              <Text bold wrap="truncate-end">{t.name}</Text>
              {t.artist ? <Text dimColor wrap="truncate-end">{t.artist}</Text> : null}
            </Box>
            <Box marginLeft={GAP} marginRight={GAP}>
              <Raster key="ring" columns={RING_COLS} rows={BAND_ROWS} cells={ring} />
            </Box>
            {side}
          </Box>
          <Text dimColor>{`\`${'-'.repeat(inner)}'`}</Text>
        </Box>
        <Box marginLeft={GAP} marginTop={1}>
          <Raster key="notes" columns={NOTES_COLS} rows={BAND_ROWS} cells={notesCells(live.notes)} />
        </Box>
      </Box>
    )
  })
}
