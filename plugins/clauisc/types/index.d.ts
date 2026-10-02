export type Track = {
  id: string
  isPlaying: boolean
  name: string
  artist: string
  album: string
  bpm: number
  position: number
  duration: number
}

export type ArtStyle = 'blocks' | 'ascii'

declare module 'claude-code' {
  interface PluginState {
    'clauisc': {
      track: Track | null
      art: string | null
      isHidden: boolean
      style: ArtStyle
      problem: string | null
    }
  }
}
