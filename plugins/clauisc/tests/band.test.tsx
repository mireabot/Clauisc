import { describe, expect, mock, test } from 'claude-code/testing'

import {
  ART_PX,
  ART_SCRIPT,
  BAND_ROWS,
  INFO_SCRIPT,
  NOTES_COLS,
  RING_COLS,
  artCells,
  beatMs,
  explainFailure,
  noteColor,
  notesCells,
  parseInfo,
  riseNotes,
  ringCells,
} from '../hooks/lib'

const decode = (cells: string) => {
  const b = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  return new Uint32Array(b.buffer)
}

const SEP = '\u001f'
const INFO = ['playing', 'ABC123', 'Pink + White', 'Frank Ocean', 'Blonde', '160', '61,5', '184.5'].join(SEP) + '\n'
const HEX = 'd97757'.repeat(ART_PX * ART_PX)

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 } },
} as const

describe('clauisc', () => {
  test('parses the AppleScript line, comma decimals included', async () => {
    const t = parseInfo(INFO)
    expect(t).toMatchObject({ isPlaying: true, id: 'ABC123', name: 'Pink + White', bpm: 160, position: 61.5, duration: 184.5 })
    expect(parseInfo('stopped\n')).toBe(null)
    const empty = ['paused', 'missing value', 'missing value', 'missing value', 'missing value', '0', '0', '0'].join(SEP)
    expect(parseInfo(empty)).toBe(null)
    // Seen on a real Mac: playing, but Music describes no track.
    const undescribed = 'playing\u001f\u001fmissing value\u001f\u001f\u001f0\u001fmissing value\u001f0'
    expect(parseInfo(undescribed)).toMatchObject({ isPlaying: true, name: 'Playing in Music', duration: 0 })
    const noAlbum = ['playing', 'X1', 'Song', 'Artist', 'missing value', 'missing value', '3', '200'].join(SEP)
    expect(parseInfo(noAlbum)).toMatchObject({ name: 'Song', album: '', bpm: 0 })
  })

  test('names no AppleScript variable after a reserved word', async () => {
    // "st", "nd", "rd" and "th" are ordinal suffixes ("1st") and fail to compile as names.
    for (const script of [INFO_SCRIPT, ART_SCRIPT]) {
      const names = [...script.matchAll(/\bset \{?([\w, ]+?)\}? to\b/g)].flatMap(m => m[1]!.split(/,\s*/))
      for (const name of names) {
        expect(['st', 'nd', 'rd', 'th']).not.toContain(name.trim())
        expect(name.trim().length).toBeGreaterThan(1)
      }
    }
  })

  test('bops on the beat, folded into a comfortable range', async () => {
    expect(beatMs(120, 0)).toBe(500)
    expect(beatMs(240, 0)).toBe(500)
    expect(beatMs(0, 0)).toBe(380)
  })

  test('draws the boombox frame with cover, text, ring and notes on the terminal', async ($, on) => {
    const ran = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    on('process.run', async ($, e) => {
      const script = e.argv[e.argv.indexOf('-e') + 1] ?? ''
      if (script.includes('raw data')) return ran('ok\n')
      if (script.includes('NSBitmapImageRep')) return ran(HEX + '\n')
      return ran(INFO)
    })
    const clock = mock.clock(on)
    on('command.register', async (_, e) => ({ value: { command: e.name } }))
    on('session.start', async (_, e) => ({ cwd: e.cwd }))
    on('ui.blit', async () => ({}))
    on('ui.render', async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine band</Text>
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await clock.advance(10)

    const ui = await $.ui.mount({ plugin: 'clauisc', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'Pink + White' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Frank Ocean' })).toBeDefined()
    expect(await ui.find({ key: 'cover' })).toBeDefined()
    expect(await ui.find({ key: 'ring' })).toBeDefined()
    expect(await ui.find({ key: 'notes' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ _+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^`-+'$/ })).toBeDefined()

    // Notes rise and the ring advances on the beat while playing.
    await clock.advance(2000)
    expect(await ui.find({ key: 'notes' })).toBeDefined()

    // /nowplaying hides the band; the engine's own band shows again.
    await $.command.run({ command: 'nowplaying', args: '' } as never)
    expect(await ui.find({ type: 'Text', text: 'Pink + White' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await ui.unmount()
  })

  test('draws a placeholder cover when the track has no artwork', async ($, on) => {
    on('process.run', async ($, e) => ({
      value: {
        exitCode: 0,
        stdout: (e.argv[e.argv.indexOf('-e') + 1] ?? '').includes('raw data') ? 'none\n' : INFO,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    const clock = mock.clock(on)
    on('command.register', async (_, e) => ({ value: { command: e.name } }))
    on('session.start', async (_, e) => ({ cwd: e.cwd }))
    on('ui.blit', async () => ({}))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await clock.advance(10)

    const ui = await $.ui.mount({ plugin: 'clauisc', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'cover' })).toBeDefined()
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    await ui.unmount()
  })

  test('picks bright note colors', async () => {
    expect(noteColor(0)).toBe(0xff0000)
    expect(noteColor(1 / 3)).toBe(0x00ff00)
    expect(noteColor(2 / 3)).toBe(0x0000ff)
  })

  test('fills the ring clockwise with the track', async () => {
    const lit = (cells: string) =>
      [...decode(cells)].filter((_, i) => i % 3 === 1).filter(c => c === 0xd97757).length
    expect(decode(ringCells(0, true)).length).toBe(RING_COLS * BAND_ROWS * 3)
    expect(lit(ringCells(0, true))).toBe(0)
    expect(lit(ringCells(0.5, true))).toBeGreaterThan(lit(ringCells(0.1, true)))
    expect(lit(ringCells(1, true))).toBeGreaterThan(lit(ringCells(0.5, true)))
    expect(lit(ringCells(1, false))).toBe(0)
  })

  test('notes start at the bottom, rise a row a beat and leave at the top', async () => {
    let notes = riseNotes([], () => 0.4)
    expect(notes).toEqual([expect.objectContaining({ row: BAND_ROWS - 1 })])
    for (let i = 0; i < BAND_ROWS; i++) notes = riseNotes(notes, () => 0.4)
    expect(notes.length).toBe(BAND_ROWS)
    expect(notes.map(n => n.row).sort()).toEqual([0, 1, 2])
    expect(riseNotes(notes, () => 0.4, false).length).toBe(BAND_ROWS - 1)
    expect(decode(notesCells(notes)).length).toBe(NOTES_COLS * BAND_ROWS * 3)
  })

  test('explains a blocked Automation permission instead of hiding', async ($, on) => {
    on('process.run', async () => ({
      value: {
        exitCode: 1,
        stdout: '',
        stderr: 'execution error: Not authorized to send Apple events to Music. (-1743)',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    const clock = mock.clock(on)
    on('command.register', async (_, e) => ({ value: { command: e.name } }))
    on('session.start', async (_, e) => ({ cwd: e.cwd }))
    on('ui.blit', async () => ({}))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await clock.advance(10)

    const ui = await $.ui.mount({ plugin: 'clauisc', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /Automation/ })).toBeDefined()
    await ui.unmount()
    expect(explainFailure('boom (-1743)')).toMatch(/Privacy & Security/)
  })

  test('keeps polling after osascript fails once, and status says what happened', async ($, on) => {
    let calls = 0
    on('process.run', async ($, e) => {
      calls += 1
      if (calls === 1) throw new Error('timed out')
      const script = e.argv[e.argv.indexOf('-e') + 1] ?? ''
      return {
        value: {
          exitCode: 0,
          stdout: script.includes('raw data') ? 'none\n' : INFO,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    })
    const clock = mock.clock(on)
    on('command.register', async (_, e) => ({ value: { command: e.name } }))
    on('session.start', async (_, e) => ({ cwd: e.cwd }))
    on('ui.blit', async () => ({}))
    on('ui.render', async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine band</Text>
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await clock.advance(10)
    await clock.advance(2000)

    const ui = await $.ui.mount({ plugin: 'clauisc', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'Pink + White' })).toBeDefined()
    const report = await $.command.run({ command: 'nowplaying', args: 'status' } as never)
    expect(JSON.stringify(report)).toMatch(/playing \\"Pink \+ White\\"/)
    await ui.unmount()
  })

  test('follows pause and resume both ways', async ($, on) => {
    let state = 'paused'
    on('process.run', async ($, e) => {
      const script = e.argv[e.argv.indexOf('-e') + 1] ?? ''
      const stdout = script.includes('raw data') ? 'none\n' : INFO.replace('playing', state)
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const clock = mock.clock(on)
    on('command.register', async (_, e) => ({ value: { command: e.name } }))
    on('session.start', async (_, e) => ({ cwd: e.cwd }))
    on('ui.blit', async () => ({}))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await clock.advance(10)

    const ui = await $.ui.mount({ plugin: 'clauisc', surface: 'terminal', ...BAND })
    const ringLit = async () => {
      const ring = await ui.find({ key: 'ring' })
      return [...decode(String(ring?.props.cells))].filter((_, i) => i % 3 === 1).includes(0xd97757)
    }
    expect(await ringLit()).toBe(false)

    state = 'playing'
    await clock.advance(2500)
    expect(await ringLit()).toBe(true)

    state = 'paused'
    await clock.advance(2500)
    expect(await ringLit()).toBe(false)
    await ui.unmount()
  })

  test('encodes every cover style as whole cells', async () => {
    expect(artCells(HEX, 16, 'blocks')).toEqual(expect.any(String))
    expect(artCells(HEX, 8, 'ascii')).toEqual(expect.any(String))
    expect(artCells(null, 16, 'blocks')).toEqual(expect.any(String))
  })
})
