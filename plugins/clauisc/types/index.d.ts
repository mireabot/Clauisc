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

declare module 'claude-code' {
  interface PluginState {
    'clauisc': {
      track: Track | null
      isHidden: boolean
      problem: string | null
      width: number | null
    }
  }
}
