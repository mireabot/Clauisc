import { describe, expect, mock, test } from 'claude-code/testing'

import { ART_PX, BOOMBOX_COLS, artCells, beatMs, boomboxCells, noteColor, parseInfo, plushCells } from '../hooks/lib'

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
  })

  test('bops on the beat, folded into a comfortable range', async () => {
    expect(beatMs(120, 0)).toBe(500)
    expect(beatMs(240, 0)).toBe(500)
    expect(beatMs(0, 0)).toBe(380)
  })

  test('draws cover, text and plush right-aligned on the terminal', async ($, on) => {
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
    expect(await ui.find({ key: 'plush' })).toBeDefined()
    expect(await ui.find({ key: 'boombox' })).toBeDefined()

    // The plush bops on the beat while playing.
    await clock.advance(2000)
    expect(await ui.find({ key: 'plush' })).toBeDefined()

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

  test("colors each beat's note brightly and draws it in that color", async () => {
    expect(noteColor(0)).toBe(0xff0000)
    expect(noteColor(1 / 3)).toBe(0x00ff00)
    for (const frame of [0, 1, 2, 3]) {
      const b = Uint8Array.from(atob(plushCells(frame, 0x12ab34)), c => c.charCodeAt(0))
      const words = new Uint32Array(b.buffer)
      const notes = [...Array(words.length / 3).keys()].filter(i => words[i * 3] === 0x266a)
      expect(notes.length).toBe(1)
      expect(words[notes[0]! * 3 + 1]).toBe(0x12ab34)
    }
    const still = Uint8Array.from(atob(plushCells(-1, 0x12ab34)), c => c.charCodeAt(0))
    expect(new Uint32Array(still.buffer).includes(0x266a)).toBe(false)
  })

  test("keeps VK's boombox as drawn and colors only its notes", async () => {
    const decode = (cells: string) => {
      const b = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
      return new Uint32Array(b.buffer)
    }
    const words = decode(boomboxCells([0x111111, 0x222222, 0x333333]))
    const row = (r: number) =>
      String.fromCharCode(...[...Array(BOOMBOX_COLS).keys()].map(c => words[(r * BOOMBOX_COLS + c) * 3]!)).trimEnd()
    expect(row(4)).toBe('         |    bla bla bla')
    expect(row(7)).toBe('|(%)[oo](%)| VK')
    const colored = new Set([...Array(words.length / 3).keys()].map(i => words[i * 3 + 1]))
    expect([...colored].sort()).toEqual([0x111111, 0x222222, 0x333333, 0x01000000].sort())
    const resting = decode(boomboxCells(null))
    expect(resting.includes(0x111111)).toBe(false)
  })

  test('encodes every frame and style as whole cells', async () => {
    for (const f of [-1, 0, 1, 2, 3]) expect(plushCells(f).length % 4).toBe(0)
    expect(artCells(HEX, 16, 'blocks')).toEqual(expect.any(String))
    expect(artCells(HEX, 8, 'ascii')).toEqual(expect.any(String))
    expect(artCells(null, 16, 'blocks')).toEqual(expect.any(String))
  })
})
