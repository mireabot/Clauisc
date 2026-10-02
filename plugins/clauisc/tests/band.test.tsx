import { describe, expect, mock, test } from 'claude-code/testing'

import { ART_PX, artCells, beatMs, parseInfo, plushCells } from '../hooks/lib'

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

  test('encodes every frame and style as whole cells', async () => {
    for (const f of [-1, 0, 1, 2, 3]) expect(plushCells(f).length % 4).toBe(0)
    expect(artCells(HEX, 16, 'blocks')).toEqual(expect.any(String))
    expect(artCells(HEX, 8, 'ascii')).toEqual(expect.any(String))
    expect(artCells(null, 16, 'blocks')).toEqual(expect.any(String))
  })
})
