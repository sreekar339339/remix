import { Events } from './index.tsx'

export class TestEventsFactory extends Events {
  submitted(detail: { id: string }) {}
  paid() {}
  focusRequested() {}
}

export function createEvents() {
  return TestEventsFactory.define()
}

export async function settleEffects() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}