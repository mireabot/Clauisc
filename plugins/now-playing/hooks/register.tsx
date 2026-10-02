import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Track } from '../types'
import {
  ART_PX,
  ART_SCRIPT,
  INFO_SCRIPT,
  PLUSH_COLS,
  PLUSH_ROWS,
  SAMPLE_SCRIPT,
  artCells,
  beatMs,
  clock,
  isPixels,
  parseInfo,
  plushCells,
  progressBar,
} from './lib'

const track = atom({ plugin: 'now-playing', key: 'track' } as const, null)
const art = atom({ plugin: 'now-playing', key: 'art' } as const, null)
const isHidden = atom({ plugin: 'now-playing', key: 'isHidden' } as const, false)
const style = atom({ plugin: 'now-playing', key: 'style' } as const, 'blocks')

const ART_FILE = '/tmp/claude-now-playing-art'
const POLL_MS = 2000

// Module state for polling and the animation only; what the band draws lives in $.state.
const live = {
  current: null as Track | null,
  artFor: null as string | null,
  frame: 0,
  bandId: null as string | null,
  isPolling: false,
  poller: null as Timer | null,
}

async function loadArt($: EngineInterface, id: string) {
  let pixels: string | null = null
  try {
    const dumped = await $.process.run(['osascript', '-e', ART_SCRIPT, ART_FILE], { timeoutMs: 8000 })
    if (dumped.stdout.trim() === 'ok') {
      const sampled = await $.process.run(
        ['osascript', '-l', 'JavaScript', '-e', SAMPLE_SCRIPT, ART_FILE, String(ART_PX), String(ART_PX)],
        { timeoutMs: 8000 },
      )
      const hex = sampled.stdout.trim()
      if (isPixels(hex)) pixels = hex
    }
  } catch {
    // No artwork is drawn as a placeholder.
  }
  if (live.artFor === id) await update($, art, () => pixels)
}

async function poll($: EngineInterface) {
  if (live.isPolling) return
  live.isPolling = true
  try {
    const { stdout } = await $.process.run(['osascript', '-e', INFO_SCRIPT], { timeoutMs: 5000 })
    const now = parseInfo(stdout)
    live.current = now
    await update($, track, () => now)
    if (now && now.id !== live.artFor) {
      live.artFor = now.id
      await update($, art, () => null)
      await loadArt($, now.id)
    }
    if (!now) live.artFor = null
  } catch {
    // osascript missing (not macOS): stop asking.
    live.poller?.cancel()
    live.poller = null
  } finally {
    live.isPolling = false
  }
}

function bop($: EngineInterface) {
  $.clock.after(beatMs(live.current?.bpm ?? 0, Math.random()), () => {
    if (live.current?.isPlaying && live.bandId) {
      live.frame = (live.frame + 1) % 4
      $.ui
        .blit({ requestId: live.bandId, key: 'plush', cells: plushCells(live.frame) })
        .catch(() => undefined)
    }
    bop($)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nowplaying',
      description: 'Toggle the Apple Music band; "/nowplaying ascii" or "blocks" switches the cover style',
    })
    void poll($)
    live.poller = $.clock.every(POLL_MS, () => void poll($))
    bop($)

    return next(e)
  })

  on('command.run', { command: 'nowplaying' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'ascii' || arg === 'blocks') {
      await update($, style, () => arg)
      await update($, isHidden, () => false)
      return { text: `Now playing: cover drawn as ${arg}.` }
    }
    const hidden = await update($, isHidden, was => !was)
    return { text: hidden ? 'Now playing band hidden.' : 'Now playing band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const t = await read($, track)
    if (e.props.hasSurvey || t === null || (await read($, isHidden))) return next(e)

    live.bandId = e.requestId
    const { Box, Text, Raster } = $.ui.resolve(e)
    const cols = e.props.bodyColumns
    const artSize = e.props.maxRows >= 8 && cols >= 70 ? 16 : 8
    const artRows = artSize / 2
    const textCols = Math.max(0, Math.min(34, cols - artSize - PLUSH_COLS - 6))
    const status = t.isPlaying ? '▶' : '⏸'
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
        <Box marginLeft={1}>
          <Raster
            key="plush"
            columns={PLUSH_COLS}
            rows={PLUSH_ROWS}
            cells={plushCells(t.isPlaying ? live.frame : -1)}
          />
        </Box>
      </Box>
    )
  })
}
