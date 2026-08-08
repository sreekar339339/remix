/**
 * Brand symbol an event may carry to describe the structural changes it
 * caused. Keyed list elements use the routes to apply minimal fine-grained
 * DOM work instead of re-resolving every item.
 */
export const EVENT_ROUTES: unique symbol = Symbol.for('rmx:event-routes')

/** Structural operation an event performed on one addressed value. */
export type EventRouteOp = 'add' | 'remove' | 'replace'

/**
 * Structural routing information an event carries for keyed list elements:
 * one op per address, index-aligned.
 */
export type EventRoutes = {
  addresses: readonly (readonly unknown[])[]
  ops: readonly EventRouteOp[]
}

/**
 * Reads the structural routes an event carries, when present.
 * @param event The dispatched event to inspect.
 * @returns The event's routes, or undefined when it carries none.
 */
export function getEventRoutes(event: unknown): EventRoutes | undefined {
  return event !== null && (typeof event === 'object' || typeof event === 'function')
    ? (Reflect.get(event, EVENT_ROUTES) as EventRoutes | undefined)
    : undefined
}

/**
 * One minimal change a keyed list element applies to its committed children.
 * `key` identifies the item for template rendering.
 */
export type ListAction =
  | { op: 'insert'; index: number; item: unknown; key: unknown }
  | { op: 'remove'; index: number }
  | { op: 'rebuild'; index: number; item: unknown; key: unknown }
  | { op: 'fallback' }

/**
 * Decodes structural event routes into minimal list actions. The decoder is
 * pure: it never renders or touches the DOM, so the element applies the
 * actions or discards them for a full re-resolve.
 *
 * Map and Set routes are key-anchored: the address segment is the item key
 * and iteration order supplies positions. Array routes are index-anchored:
 * adds insert, removes drop, and a replace whose value already follows the
 * slot is a shift, so deleting an item mid-array removes one child instead
 * of rebuilding the tail. Anything unrecognized falls back.
 *
 * @param detail The current collection value (Map, Set, or array).
 * @param items The committed item references, index-aligned with keys.
 * @param keys The committed item keys, index-aligned with items.
 * @param routes The event's structural routes, when present.
 * @returns The minimal list actions to apply, or a fallback action.
 */
export function decodeListRoutes(
  detail: unknown,
  items: readonly unknown[],
  keys: readonly unknown[],
  routes: EventRoutes | undefined,
): ListAction[] {
  if (routes === undefined) return [{ op: 'fallback' }]
  let { addresses, ops } = routes
  if (addresses.length !== ops.length) return [{ op: 'fallback' }]
  if (detail instanceof Map || detail instanceof Set) {
    return decodeKeyedRoutes(detail, keys, addresses, ops)
  }
  if (Array.isArray(detail)) return decodeArrayRoutes(detail, items, addresses, ops)
  return [{ op: 'fallback' }]
}

function decodeKeyedRoutes(
  detail: Map<unknown, unknown> | Set<unknown>,
  keys: readonly unknown[],
  addresses: readonly (readonly unknown[])[],
  ops: readonly EventRouteOp[],
): ListAction[] {
  let currentKeys = keys.slice()
  let detailKeys = detail instanceof Map ? Array.from(detail.keys()) : Array.from(detail)
  let actions: ListAction[] = []
  for (let index = 0; index < ops.length; index++) {
    let address = addresses[index]
    let op = ops[index]
    if (address.length !== 1) return [{ op: 'fallback' }]
    let key = address[0]
    if (op === 'add') {
      let position = detailKeys.findIndex((candidate) => samePropertyKey(candidate, key))
      if (position === -1) return [{ op: 'fallback' }]
      let itemKey = detailKeys[position]
      let item = detail instanceof Map ? detail.get(itemKey) : itemKey
      currentKeys.splice(position, 0, itemKey)
      actions.push({ op: 'insert', index: position, item, key: itemKey })
      continue
    }
    let position = currentKeys.findIndex((candidate) => samePropertyKey(candidate, key))
    if (position === -1) return [{ op: 'fallback' }]
    let itemKey = currentKeys[position]
    if (op === 'remove') {
      currentKeys.splice(position, 1)
      actions.push({ op: 'remove', index: position })
      continue
    }
    if (detail instanceof Map) {
      if (!detail.has(itemKey)) return [{ op: 'fallback' }]
      actions.push({ op: 'rebuild', index: position, item: detail.get(itemKey), key: itemKey })
      continue
    }
    actions.push({ op: 'rebuild', index: position, item: itemKey, key: itemKey })
  }
  return actions
}

function decodeArrayRoutes(
  detail: readonly unknown[],
  items: readonly unknown[],
  addresses: readonly (readonly unknown[])[],
  ops: readonly EventRouteOp[],
): ListAction[] {
  let current = items.slice()
  let actions: ListAction[] = []
  for (let index = 0; index < ops.length; index++) {
    let position = arrayIndex(addresses[index])
    if (position === undefined) return [{ op: 'fallback' }]
    let op = ops[index]
    if (op === 'add') {
      if (position > current.length) return [{ op: 'fallback' }]
      if (position < current.length && Object.is(current[position], detail[position])) {
        continue
      }
      current.splice(position, 0, detail[position])
      actions.push({ op: 'insert', index: position, item: detail[position], key: position })
      continue
    }
    if (op === 'remove') {
      if (position >= current.length) continue
      current.splice(position, 1)
      actions.push({ op: 'remove', index: position })
      continue
    }
    if (position >= current.length) return [{ op: 'fallback' }]
    let value = detail[position]
    if (Object.is(current[position], value)) continue
    if (position + 1 < current.length && Object.is(current[position + 1], value)) {
      current.splice(position, 1)
      actions.push({ op: 'remove', index: position })
      continue
    }
    if (index + 1 < ops.length) return [{ op: 'fallback' }]
    current[position] = value
    actions.push({ op: 'rebuild', index: position, item: value, key: position })
  }
  return actions
}

function arrayIndex(address: readonly unknown[]): number | undefined {
  if (address.length !== 1) return undefined
  let segment = address[0]
  if (typeof segment === 'number') {
    return Number.isInteger(segment) && segment >= 0 ? segment : undefined
  }
  if (typeof segment === 'string' && /^\d+$/.test(segment)) {
    let index = Number(segment)
    return Number.isSafeInteger(index) ? index : undefined
  }
  return undefined
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'symbol'
}

function samePropertyKey(left: unknown, right: unknown): boolean {
  return (
    Object.is(left, right) ||
    (isPropertyKey(left) &&
      isPropertyKey(right) &&
      typeof left !== 'symbol' &&
      typeof right !== 'symbol' &&
      String(left) === String(right))
  )
}
