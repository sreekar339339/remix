import { TypedEventTarget } from 'remix/ui'
import { customEvents, type CustomEventsEventMap } from './utils/customEvents/index.tsx'

type TempoBpm = number

type DrummerEvents = {
  playbackStarted: TempoBpm
  playbackStopped: TempoBpm
  tempoSet: TempoBpm
}

export class Drummer extends TypedEventTarget<CustomEventsEventMap<DrummerEvents>> {
  #isPlaying = false
  #tempoBpm = 90
  events = customEvents<DrummerEvents>({ host: this })

  constructor() {
    super()
  }

  get isPlaying() {
    return this.#isPlaying
  }

  get bpm() {
    return this.#tempoBpm
  }

  setTempo(bpm: number) {
    this.#tempoBpm = Math.max(30, Math.min(300, Math.floor(bpm || 90)))
    this.dispatchEvent(this.events.create('tempoSet', this.#tempoBpm))
  }

  play(bpm = this.#tempoBpm) {
    this.setTempo(bpm)
    if (this.#isPlaying) return
    this.#isPlaying = true
    this.dispatchEvent(this.events.create('playbackStarted', this.#tempoBpm))
  }

  stop() {
    if (!this.#isPlaying) return
    this.#isPlaying = false
    this.dispatchEvent(this.events.create('playbackStopped', this.#tempoBpm))
  }
}
