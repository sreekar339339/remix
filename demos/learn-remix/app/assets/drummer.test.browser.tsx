import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { addEventListeners } from 'remix/ui'
import { render } from 'remix/ui/test'
import { Drummer } from './drummer.ts'

describe('Drummer', () => {
  it('publishes domain events to a mounted component effect', async (t) => {
    let drummer = new Drummer()
    let events: string[] = []
    let result = render(
      <output
        mix={drummer.events.on(({ type, detail }) => {
          events.push(`${type}:${detail}`)
        })}
      />,
    )
    t.after(() => result.cleanup())

    await result.act(() => {
      drummer.play(120)
      drummer.stop()
    })

    assert.equal(drummer.bpm, 120)
    assert.equal(drummer.isPlaying, false)
    assert.deepEqual(events, ['tempoSet:120', 'playbackStarted:120', 'playbackStopped:120'])
  })

  it('supports Remix addEventListeners through its native event names', () => {
    let drummer = new Drummer()
    let controller = new AbortController()
    let events: string[] = []

    addEventListeners(drummer, controller.signal, {
      tempoSet(event) {
        let type: 'tempoSet' = event.type
        let bpm: number = event.detail
        assert.equal(event.currentTarget, drummer)
        events.push(`${type}:${bpm}`)
      },
      playbackStarted(event) {
        events.push(`playbackStarted:${event.detail}`)
      },
      playbackStopped(event) {
        events.push(`playbackStopped:${event.detail}`)
      },
    })

    drummer.play(120)
    drummer.stop()
    assert.deepEqual(events, ['tempoSet:120', 'playbackStarted:120', 'playbackStopped:120'])

    controller.abort()
    drummer.play(140)
    assert.equal(events.length, 3)
  })
})
