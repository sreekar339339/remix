import { TypedEventTarget } from 'remix/ui'
import { Events, type EventsMapOf } from './utils/customEvents/index.tsx'

type TempoBpm = number

class DrummerEvents extends Events {
  playbackStarted(detail: TempoBpm) {}
  playbackStopped(detail: TempoBpm) {}
  tempoSet(detail: TempoBpm) {}
}

export class Drummer extends TypedEventTarget<EventsMapOf<DrummerEvents>> {
  #isPlaying = false
  #tempoBpm = 90
  events = DrummerEvents.define().asHost(this)

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
    this.dispatchEvent(this.events.create({ tempoSet: this.#tempoBpm }))
  }

  play(bpm = this.#tempoBpm) {
    this.setTempo(bpm)
    if (this.#isPlaying) return
    this.#isPlaying = true
    this.dispatchEvent(this.events.create({ playbackStarted: this.#tempoBpm }))
  }

  stop() {
    if (!this.#isPlaying) return
    this.#isPlaying = false
    this.dispatchEvent(this.events.create({ playbackStopped: this.#tempoBpm }))
  }
}
