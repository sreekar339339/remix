import { createMixin, ref } from 'remix/ui'
import {
  createCurrentTargetEvent,
  customEventsRuntime,
  type CustomEventsRuntimeState,
} from './runtime.ts'
import type { EventSourceMetadata } from './eventSources.ts'

export const customEventsOnMixin = createMixin<
  Element,
  [
    runtime: CustomEventsRuntimeState,
    source: EventSourceMetadata | undefined,
    listener: (event: Event) => void | Promise<unknown>,
  ]
>((handle) => (runtime, source, listener) => (
  <handle.element
    mix={ref((element, signal) => {
      customEventsRuntime.subscribe(
        runtime,
        'effect',
        {
          element,
          eventTypes: source ? new Set([source.type]) : null,
          ...(source ? { addresses: new Map([[source.type, source.path]]) } : {}),
          notify(event) {
            return listener(createCurrentTargetEvent(event, element))
          },
        },
        signal,
      )
    })}
  />
))
