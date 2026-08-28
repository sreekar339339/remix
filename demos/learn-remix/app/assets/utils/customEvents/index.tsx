import { createCustomEventsDescriptor } from './descriptor.tsx'
import {
  CUSTOM_EVENTS_SOURCE,
  customEventsEvented,
  getEventedSource,
} from './evented.tsx'
import type { RememberedEventContext } from './descriptor.tsx'
import {
  ALL_EVENTS,
  canonicalAddressSegment,
  readPath,
  samePropertyKey,
  type CustomEventsRuntimeEntry,
} from './runtime.ts'
import type {
  CustomEventsDefined,
  CustomEventsEventedViews,
  EventDetails,
  EventsApi,
} from './types.ts'
import type { DetailsOf, Draft, HandlersOf } from './types.ts'
export type {
  CustomEventsDefined,
  CustomEventsEventMap,
  DetailsHandler,
  DetailsOf,
  EventMapFrom,
  EventsApi,
  EventsMapOf,
  EventsOf,
  HandlersOf,
} from './types.ts'

type EventSourceEvent = { type: string; detail?: unknown }

/**
 * Event-aware intrinsic elements for any Events instance: `evented.<tag>`
 * resolves to a cached component that renders the matching tag, while source
 * props infer the event map from the descriptor passed as `on`.
 */
export const evented = customEventsEvented as unknown as CustomEventsEventedViews<
  EventDetails,
  never
>

// ---------------------------------------------------------------------------
// Journal kernel — a copy-on-write draft layer that records affected paths at
// write time and keeps handles valid across commits. No patches, no freezing,
// no revoked drafts; async listeners keep mutating through the same proxies.
//
// Reaction cascades are linear: within one batch session a reaction fires at
// most once (a visited set, like DFS marking nodes). A write that routes to
// an already-fired reaction still lands — the event detail updates — but the
// callback does not re-run, so A→B→A converges instead of cycling. Reactive
// self-retriggering is an explicit re-dispatch (a new session/cause).
// ---------------------------------------------------------------------------

type ProxyableNode = object

function cloneNode(node: ProxyableNode): ProxyableNode {
  if (node instanceof Map) return new Map(node as Map<unknown, unknown>)
  if (node instanceof Set) return new Set(node as Set<unknown>)
  if (Array.isArray(node)) return [...(node as unknown[])] as unknown as ProxyableNode
  return Object.assign(Object.create(Object.getPrototypeOf(node)), node)
}

function childIsProxyable(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  // Never wrap DOM/platform surfaces — handlers pass Elements around freely.
  if (typeof Element !== 'undefined' && value instanceof Element) return false
  if (typeof EventTarget !== 'undefined' && value instanceof EventTarget) return false
  if (value instanceof Promise) return false
  if (value instanceof Date || value instanceof RegExp) return false
  return true
}

/** Does any direct member hold a live draft handle? (finalize hygiene walk) */
function holdsHandles(journal: Journal, node: unknown): boolean {
  const check = (value: unknown) =>
    typeof value === 'object' && value !== null && journal.handlesByProxy.has(value)
  if (Array.isArray(node)) return (node as unknown[]).some(check)
  if (node instanceof Map) {
    for (let v of (node as Map<unknown, unknown>).values()) if (check(v)) return true
    return false
  }
  if (node instanceof Set) {
    for (let v of node as Set<unknown>) if (check(v)) return true
    return false
  }
  for (let key in node as Record<string, unknown>) {
    if (check((node as Record<string, unknown>)[key])) return true
  }
  return false
}

export type ChangeRecord = {
  /** Original top-level child node the mutations targeted. An object-slice
   * replacement anchors its replacement here instead. */
  originSource: object | undefined
  paths: Array<readonly unknown[]>
  seen: Set<string>
}

export type Journal = {
  folds: ReadonlySet<string>
  /** Copy-on-write storage keyed by ORIGINAL node during one generation. */
  copies: Map<object, unknown>
  origins: Map<object, object>
  handlesByProxy: WeakSet<object>
  /** Direct proxy -> original source map (introspection must bypass traps). */
  handleSources: WeakMap<object, object>
  /** Per-source child-handle registries stamped with the generation made. */
  children: WeakMap<object, Map<string, { generation: number; proxy: unknown }>>
  changes: Map<string, ChangeRecord>
  /** Whole-slice replacements/deletions pending at the root, readable mid-session. */
  stagedRoot: Map<string, { del?: boolean; value?: unknown }>
  baseSource: object
  onWrite?: () => void
  generation: number
  dirty: boolean
}

type Handle = {
  journal: Journal
  source: object
  /** Self-inclusive originals: ancestors[i] is the node reached by keys[0..i],
   * stored in RAW key form (numeric twins preserved, never canonicalized). */
  ancestors: object[]
  keys: unknown[]
  proxy: object
}

function originalOf(journal: Journal, value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    const mapped = journal.origins.get(value as object)
    if (mapped !== undefined) return mapped
  }
  return value
}

function copyForWrite(journal: Journal, source: object): unknown {
  let copy = journal.copies.get(source)
  if (copy === undefined) {
    copy = cloneNode(source)
    journal.copies.set(source, copy)
    journal.origins.set(copy as object, source)
  }
  return copy
}

function currentOf(journal: Journal, handle: Handle): unknown {
  return journal.copies.get(handle.source) ?? handle.source
}

function registerChange(
  journal: Journal,
  topKey: string,
  originSource: object | undefined,
): ChangeRecord {
  let record = journal.changes.get(topKey)
  if (!record) {
    record = { originSource, paths: [], seen: new Set() }
    journal.changes.set(topKey, record)
  } else if (record.originSource === undefined && originSource !== undefined) {
    record.originSource = originSource
  }
  return record
}

function pathKeyOf(segments: readonly unknown[]): string {
  let flat = ''
  for (let i = 0; i < segments.length; i++) {
    flat += (i > 0 ? '\u001f' : '') + String(canonicalAddressSegment(segments[i]))
  }
  return flat
}

function recordPath(journal: Journal, topKey: string, segments: readonly unknown[]): void {
  const record = registerChange(journal, topKey, undefined)
  const canonical = segments.map(canonicalAddressSegment)
  if (canonical.length === 0) {
    if (!record.seen.has('')) {
      record.paths.length = 0
      record.seen.clear()
      record.seen.add('')
      record.paths.push([])
    }
    return
  }
  if (record.seen.has('')) return
  const flat = pathKeyOf(canonical)
  if (!record.seen.has(flat)) {
    record.seen.add(flat)
    record.paths.push(canonical)
  }
}

/** Preserves the ORIGINAL key form (numeric twins, identity objects…). */
function setMember(node: ProxyableNode, key: unknown, value: unknown) {
  if (node instanceof Map) {
    const map = node as Map<unknown, unknown>
    if (map.has(key)) map.set(key, value)
    else if (typeof key === 'string' && map.has(Number(key))) map.set(Number(key), value)
    else {
      let matched: { found: boolean; key?: unknown } = { found: false }
      for (let [mk] of map.entries()) {
        if (samePropertyKey(mk, key)) {
          matched = { found: true, key: mk }
          break
        }
      }
      if (matched.found) map.set(matched.key, value)
      else map.set(key as any, value as any)
    }
    return
  }
  if (Array.isArray(node)) {
    ;(node as unknown[])[key as number] = value as any
    return
  }
  ;(node as Record<PropertyKey, unknown>)[key as PropertyKey] = value as any
}

/**
 * Writes the leaf into a copy, then links child copies up the ancestor chain
 * so the top-level candidate reflects every nested mutation.
 *
 * Invariants: `keys.length === ancestors.length`; `ancestors[i]` is the
 * ORIGINAL node reached by the RAW key prefix `keys[0..i]` (self-inclusive,
 * so the top-level candidate is always `ancestors[0]`).
 */
function propagate(journal: Journal, handle: Handle, applyLeaf: (current: unknown) => void) {
  journal.dirty = true
  journal.onWrite?.()
  const n = handle.keys.length
  if (n === 0) return
  const leaf = copyForWrite(journal, handle.source)
  applyLeaf(leaf)
  for (let i = n - 1; i >= 1; i--) {
    const parentCopy = copyForWrite(journal, handle.ancestors[i - 1]) as ProxyableNode
    const childNode = handle.ancestors[i]
    setMember(parentCopy, handle.keys[i], journal.copies.get(childNode) ?? childNode)
  }
  const topOrigin = handle.ancestors[0]
  registerChange(journal, String(handle.keys[0]), topOrigin)
}

function journalPathSegments(handle: Handle): unknown[] {
  return handle.keys.slice(1).map(canonicalAddressSegment)
}

/** Self-inclusive ancestry: children append their own RAW original. */
function makeChildHandle(
  journal: Journal,
  parent: Handle,
  rawKey: unknown,
  rawOriginal: unknown,
): object {
  const handle: Handle = {
    journal,
    source: rawOriginal as object,
    ancestors: [...parent.ancestors, rawOriginal as object],
    keys: [...parent.keys, rawKey],
    proxy: undefined as unknown as object,
  }
  handle.proxy = createProxy(handle)
  journal.handlesByProxy.add(handle.proxy)
  journal.handleSources.set(handle.proxy, handle.source)
  return handle.proxy
}

function getChildHandle(
  journal: Journal,
  parent: Handle,
  key: PropertyKey,
  rawValue: unknown,
): unknown {
  if (!childIsProxyable(rawValue)) return rawValue
  const parentNode = currentOf(journal, parent) as ProxyableNode
  let registry = journal.children.get(parent.source)
  if (registry === undefined) {
    registry = new Map()
    journal.children.set(parent.source, registry)
  }
  const cacheKey = 'p\u0000' + pathKeyOf([key])
  const existing = registry.get(cacheKey)
  if (existing !== undefined && existing.generation === journal.generation) {
    return existing.proxy
  }
  const childOriginal = originalOf(journal, Reflect.get(parentNode, key as any))
  if (!childIsProxyable(childOriginal)) return childOriginal
  const proxy = makeChildHandle(journal, parent, key, childOriginal)
  registry.set(cacheKey, { generation: journal.generation, proxy })
  return proxy
}

function createProxy(handle: Handle): object {
  const { journal } = handle
  const handler: ProxyHandler<any> = {
    get(_target, prop, receiver) {
      if (
        handle.keys.length === 0 &&
        typeof prop === 'string' &&
        journal.folds.has(prop)
      ) {
        return Reflect.get(handle.source, prop)
      }
      if (handle.keys.length === 0 && typeof prop === 'string') {
        const staged = journal.stagedRoot.get(prop)
        if (staged !== undefined) return staged.del ? undefined : staged.value
      }
      const current = currentOf(journal, handle)
      if (prop === 'size' && (current instanceof Map || current instanceof Set)) {
        return (current as Map<unknown, unknown>).size
      }
      const value = Reflect.get(current as object, prop, receiver)

      if (current instanceof Map) {
        const map = current as Map<unknown, unknown>
        if (prop === 'get') {
          return (k: unknown) => {
            // Resolve the ACTUAL stored key so handles and ancestry keep the
            // raw form (numeric twins collapse onto the original entry).
            let actualKey: unknown = k
            if (!map.has(k)) {
              if (typeof k === 'string' && map.has(Number(k))) actualKey = Number(k)
              else {
                let matched: unknown
                for (let [mk] of map.entries()) {
                  if (samePropertyKey(mk, k)) {
                    matched = mk
                    break
                  }
                }
                if (matched === undefined) return undefined
                actualKey = matched
              }
            }
            const raw = map.get(actualKey)
            if (!childIsProxyable(raw)) return raw
            const reg = journal.children.get(handle.source)
            const cacheKey = 'm\u0000' + pathKeyOf([actualKey])
            const cached = reg?.get(cacheKey)
            if (cached !== undefined && cached.generation === journal.generation) {
              return cached.proxy
            }
            const orig = originalOf(journal, raw)
            const proxy = makeChildHandle(journal, handle, actualKey, orig)
            reg?.set(cacheKey, { generation: journal.generation, proxy })
            return proxy
          }
        }
        if (prop === 'set') {
          return (k: unknown, v: unknown) => {
            // Same-value writes are no-ops (immer parity): no copy, no route.
            if (map.has(k) && Object.is(map.get(k), v)) return handle.proxy
            propagate(journal, handle, (cur) => {
              ;(cur as Map<unknown, unknown>).set(k, v)
            })
            recordPath(journal, String(handle.keys[0]), [
              ...journalPathSegments(handle),
              canonicalAddressSegment(k),
            ])
            return handle.proxy
          }
        }
        if (prop === 'has') return (k: unknown) => map.has(k)
        if (prop === 'delete') {
          return (k: unknown) => {
            let removed = false
            propagate(journal, handle, (cur) => {
              removed = (cur as Map<unknown, unknown>).delete(k)
            })
            if (removed) {
              recordPath(journal, String(handle.keys[0]), [
                ...journalPathSegments(handle),
                canonicalAddressSegment(k),
              ])
            }
            return removed
          }
        }
        if (prop === 'clear') {
          return () => {
            // Route Map clears by KEY (Set clears route by value below).
            const members = [...map.keys()]
            propagate(journal, handle, (cur) => {
              ;(cur as Map<unknown, unknown>).clear()
            })
            const base = [...journalPathSegments(handle)]
            if (members.length === 0) {
              recordPath(journal, String(handle.keys[0]), base)
            } else {
              for (let m of members) {
                recordPath(journal, String(handle.keys[0]), [
                  ...base,
                  canonicalAddressSegment(m),
                ])
              }
            }
          }
        }
        if (prop === 'entries' || prop === 'keys' || prop === 'values' || prop === Symbol.iterator) {
          const fn = (map as any)[prop]
          return typeof fn === 'function' ? fn.bind(map) : undefined
        }
        if (prop === 'forEach') return map.forEach.bind(map)
      }

      if (current instanceof Set) {
        const set = current as Set<unknown>
        if (prop === 'add') {
          return (v: unknown) => {
            if (set.has(v)) return handle.proxy
            propagate(journal, handle, (cur) => {
              ;(cur as Set<unknown>).add(v)
            })
            recordPath(journal, String(handle.keys[0]), [
              ...journalPathSegments(handle),
              canonicalAddressSegment(v),
            ])
            return handle.proxy
          }
        }
        if (prop === 'has') return (v: unknown) => set.has(v)
        if (prop === 'delete') {
          return (v: unknown) => {
            let removed = false
            propagate(journal, handle, (cur) => {
              removed = (cur as Set<unknown>).delete(v)
            })
            if (removed) {
              recordPath(journal, String(handle.keys[0]), [
                ...journalPathSegments(handle),
                canonicalAddressSegment(v),
              ])
            }
            return removed
          }
        }
        if (prop === 'clear') {
          return () => {
            const members = [...set.values()]
            propagate(journal, handle, (cur) => {
              ;(cur as Set<unknown>).clear()
            })
            const base = [...journalPathSegments(handle)]
            if (members.length === 0) {
              recordPath(journal, String(handle.keys[0]), base)
            } else {
              for (let m of members) {
                recordPath(journal, String(handle.keys[0]), [
                  ...base,
                  canonicalAddressSegment(m),
                ])
              }
            }
          }
        }
        if (prop === 'entries' || prop === 'keys' || prop === 'values' || prop === Symbol.iterator) {
          const fn = (set as any)[prop]
          return typeof fn === 'function' ? fn.bind(set) : undefined
        }
        if (prop === 'forEach') return set.forEach.bind(set)
      }

      if (current instanceof Array) {
        const list = current as unknown[]
        const base = [...journalPathSegments(handle)]
        const rangeAll = (from: number, to: number) => {
          for (let i = Math.max(0, from); i <= Math.max(0, to); i++) {
            recordPath(journal, String(handle.keys[0]), [...base, i])
          }
        }
        if (prop === 'push')
          return (...args: unknown[]) => {
            const from = list.length
            propagate(journal, handle, (cur) => {
              ;(cur as unknown[]).push(...args)
            })
            rangeAll(from, (currentOf(journal, handle) as unknown[]).length - 1)
            return (currentOf(journal, handle) as unknown[]).length
          }
        if (prop === 'pop')
          return () => {
            let popped: unknown
            propagate(journal, handle, (cur) => {
              popped = (cur as unknown[]).pop()
            })
            recordPath(journal, String(handle.keys[0]), [...base, list.length - 1])
            return popped
          }
        if (prop === 'shift')
          return () => {
            let shifted: unknown
            propagate(journal, handle, (cur) => {
              shifted = (cur as unknown[]).shift()
            })
            rangeAll(0, (currentOf(journal, handle) as unknown[]).length - 1)
            return shifted
          }
        if (prop === 'unshift')
          return (...args: unknown[]) => {
            propagate(journal, handle, (cur) => {
              ;(cur as unknown[]).unshift(...args)
            })
            rangeAll(0, (currentOf(journal, handle) as unknown[]).length - 1)
            return (currentOf(journal, handle) as unknown[]).length
          }
        if (prop === 'splice')
          return (...args: unknown[]) => {
            const startIndex = args.length === 0 ? list.length : Number(args[0]) || 0
            const insertCount = args.length > 2 ? Math.max(args.length - 2, 0) : 0
            const priorLength = list.length
            let removedItems: unknown[] = []
            propagate(journal, handle, (cur) => {
              removedItems = (cur as unknown[]).splice(...(args as [number, number]))
            })
            const lengthAfter = (currentOf(journal, handle) as unknown[]).length
            const last = Math.max(startIndex + insertCount, priorLength - 1, lengthAfter - 1)
            rangeAll(Math.max(0, startIndex), last)
            return removedItems ?? []
          }
      }

      if (childIsProxyable(value)) {
        return getChildHandle(journal, handle, prop, value)
      }
      return value
    },
    set(_target, prop, value) {
      const topKey = String(handle.keys[0])
      if (handle.keys.length === 0) {
        // Whole-slice replacement at the root.
        const key = String(prop)
        if (childIsProxyable(value)) {
          // Anchor an object slice in the journal so later descents mutate
          // through drafted copies instead of the caller's raw reference.
          const anchored = makeChildHandle(journal, handle, key, value)
          journal.stagedRoot.set(key, { value: anchored })
          const record = registerChange(journal, key, value as object)
          record.seen.clear()
          record.paths.length = 0
          record.paths.push([])
          record.seen.add('')
        } else {
          journal.stagedRoot.set(key, { value })
          const record = registerChange(journal, key, undefined)
          record.seen.clear()
          record.paths.length = 0
          record.paths.push([])
          record.seen.add('')
        }
        journal.dirty = true
        journal.onWrite?.()
        return true
      }
      // Same-value writes are no-ops (immer parity): no copy, no route.
      if (Object.is(Reflect.get(currentOf(journal, handle) as object, prop), value)) return true
      propagate(journal, handle, (cur) => {
        setMember(cur as ProxyableNode, prop, value)
      })
      recordPath(journal, topKey, [...journalPathSegments(handle), prop as unknown])
      return true
    },
    deleteProperty(_target, prop) {
      const topKey = String(handle.keys[0])
      if (handle.keys.length === 0) {
        const key = String(prop)
        journal.stagedRoot.set(key, { del: true })
        const record = registerChange(journal, key, undefined)
        record.seen.clear()
        record.paths.length = 0
        record.paths.push([])
        record.seen.add('')
        journal.dirty = true
        journal.onWrite?.()
        return true
      }
      propagate(journal, handle, (cur) => {
        if (cur instanceof Map) (cur as Map<unknown, unknown>).delete(prop)
        else Reflect.deleteProperty(cur as object, prop)
      })
      recordPath(journal, topKey, [...journalPathSegments(handle), prop as unknown])
      return true
    },
    has(_target, prop) {
      if (handle.keys.length === 0 && typeof prop === 'string') {
        const staged = journal.stagedRoot.get(prop)
        if (staged !== undefined) return !staged.del
      }
      return Reflect.has(currentOf(journal, handle) as object, prop)
    },
    ownKeys(_target) {
      if (handle.keys.length === 0) {
        const keys = new Set(Reflect.ownKeys(handle.source))
        for (let [key, staged] of journal.stagedRoot) {
          if (staged.del) keys.delete(key)
          else keys.add(key)
        }
        return [...keys]
      }
      return Reflect.ownKeys(currentOf(journal, handle) as object)
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(currentOf(journal, handle) as object, prop)
    },
  }
  return new Proxy(handle.source, handler)
}

function createJournal(base: object, folds: ReadonlySet<string>): { journal: Journal; root: object } {
  const journal: Journal = {
    folds,
    copies: new Map(),
    origins: new Map(),
    handlesByProxy: new WeakSet(),
    handleSources: new WeakMap(),
    children: new WeakMap(),
    changes: new Map(),
    stagedRoot: new Map(),
    baseSource: base,
    onWrite: undefined,
    generation: 0,
    dirty: false,
  }
  const rootHandle: Handle = {
    journal,
    source: base,
    ancestors: [],
    keys: [],
    proxy: undefined as unknown as object,
  }
  rootHandle.proxy = createProxy(rootHandle)
  journal.handlesByProxy.add(rootHandle.proxy)
  journal.handleSources.set(rootHandle.proxy, rootHandle.source)
  return { journal, root: rootHandle.proxy }
}

/**
 * Resolves copied subtrees so no draft handles remain anywhere reachable,
 * sharing untouched branches verbatim. Freshly built containers holding
 * handles are cleaned too, keeping mid-handler snapshots like
 * `new Map(this.x)` faithful to the committed generation.
 */
function finalizeValue(journal: Journal, value: unknown, memo: Map<unknown, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (journal.handlesByProxy.has(value)) {
    const source = journal.handleSources.get(value as object)!
    return finalizeValue(journal, journal.copies.get(source) ?? source, memo)
  }
  if (!childIsProxyable(value)) return value
  const cached = memo.get(value)
  if (cached !== undefined) return cached
  const modified = journal.copies.get(value as object)
  if (modified === undefined && !holdsHandles(journal, value)) {
    memo.set(value, value)
    return value
  }
  const clone = cloneNode((modified ?? value) as ProxyableNode)
  memo.set(value, clone)
  if (clone instanceof Map) {
    const target = clone as Map<unknown, unknown>
    for (let [k, v] of [...target.entries()]) target.set(k, finalizeValue(journal, v, memo))
  } else if (clone instanceof Set) {
    const target = clone as Set<unknown>
    const cleaned = [...target.values()].map((v) => finalizeValue(journal, v, memo))
    target.clear()
    for (let v of cleaned) target.add(v)
  } else if (Array.isArray(clone)) {
    const target = clone as unknown[]
    for (let i = 0; i < target.length; i++) target[i] = finalizeValue(journal, target[i], memo)
  } else {
    for (let key of Object.keys(clone as object)) {
      ;(clone as Record<string, unknown>)[key] = finalizeValue(
        journal,
        (clone as Record<string, unknown>)[key],
        memo,
      )
    }
  }
  return clone
}

/**
 * Walks a path through journal proxies so intermediate objects stay drafted:
 * reaction receivers can keep mutating through them (raw reads would bypass
 * the write recorder). Collection member navigation mirrors readPath's
 * canonical-segment resolution exactly.
 */
function walkProxy(start: unknown, segments: readonly unknown[]): unknown {
  let current = start
  for (let segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    if (current instanceof Map) {
      const map = current as Map<unknown, unknown>
      if (map.has(segment)) current = map.get(segment)
      else if (typeof segment === 'string' && map.has(Number(segment))) {
        current = map.get(Number(segment))
      } else {
        let found: unknown
        for (let [mk, mv] of map.entries()) {
          if (samePropertyKey(mk, segment)) {
            found = mv
            break
          }
        }
        current = found
      }
    } else if (current instanceof Set) current = (current as any).has(segment)
    else if (Array.isArray(current)) current = (current as any)[Number(segment)]
    else current = Reflect.get(current as object, segment as PropertyKey)
  }
  return current
}

/** Commits pending generations onto the live composite and emits entries. */
function commitJournal(journal: Journal, live: EventDetails): CustomEventsRuntimeEntry[] {
  if (!journal.dirty || journal.changes.size === 0) {
    journal.dirty = false
    journal.copies.clear()
    journal.origins.clear()
    journal.stagedRoot.clear()
    journal.generation++
    return []
  }
  const entries: CustomEventsRuntimeEntry[] = []
  const memo = new Map<unknown, unknown>()
  const rootRegistry = journal.children.get(journal.baseSource)
  const invalidateRootChild = (key: string) => {
    // Published nodes are fresh identities; cached handles must not survive.
    rootRegistry?.delete(key)
  }
  for (let [key, record] of journal.changes) {
    const previous = (live as Record<string, unknown>)[key]
    invalidateRootChild(key)
    const entry: CustomEventsRuntimeEntry = {
      type: key,
      detail: undefined,
      addresses: [],
    }

    const staged = journal.stagedRoot.get(key)
    if (staged !== undefined && staged.del) {
      delete (live as Record<string, unknown>)[key]
      entry.detail = undefined
      entries.push(entry)
      continue
    }

    const cleanNext =
      staged !== undefined
        ? finalizeValue(journal, staged.value, memo)
        : record.originSource !== undefined
          ? finalizeValue(journal, record.originSource, memo)
          : (live as Record<string, unknown>)[key]
    ;(live as Record<string, unknown>)[key] = cleanNext
    entry.detail = cleanNext
    if (isPrimitive(previous) && isPrimitive(cleanNext)) {
      entry.addresses = sliceAddresses(previous, cleanNext)
    } else {
      entry.addresses = record.paths
    }
    entries.push(entry)
  }
  journal.changes.clear()
  journal.stagedRoot.clear()
  journal.dirty = false
  journal.copies.clear()
  journal.origins.clear()
  journal.generation++
  return entries
}

// ---------------------------------------------------------------------------
// Batch sessions
// ---------------------------------------------------------------------------

type BatchFn<Held extends EventDetails> = (
  detail: unknown,
  composite: Draft<Held>,
) => void | Promise<unknown>

function createDeferredQueue() {
  type Deferred = {
    run: () => Promise<void> | void
    resolve: () => void
    reject: (error: unknown) => void
  }
  let queue: Deferred[] = []
  return {
    defer(run: () => Promise<void> | void) {
      return new Promise<void>((resolve, reject) => {
        queue.push({ run, resolve, reject })
      })
    },
    drain() {
      if (queue.length === 0) return []
      let completions: Array<Promise<void>> = []
      while (queue.length > 0) {
        let pending = queue.splice(0)
        for (let { run, resolve, reject } of pending) {
          let completion = Promise.resolve(run())
          completion.then(resolve, reject)
          completions.push(completion)
        }
      }
      return completions
    },
  }
}

type DeferredQueue = ReturnType<typeof createDeferredQueue>

/** The live batch session, tracked for the descriptor's dispatch deferral. */
type BatchSessionRef = {
  current: {
    dirty: boolean
    flushNow?: () => void
  } | undefined
}

/** Reactions indexed by their slice for O(1) lookup per dispatched entry. */
type ReactionIndex = { byKey: Map<string, Reaction[]>; wildcards: Reaction[] }

function buildReactionIndex(reactions: Reaction[]): ReactionIndex {
  let byKey = new Map<string, Reaction[]>()
  let wildcards: Reaction[] = []
  for (let reaction of reactions) {
    if (reaction.type === ALL_EVENTS) wildcards.push(reaction)
    else {
      let list = byKey.get(reaction.type)
      if (!list) byKey.set(reaction.type, (list = []))
      list.push(reaction)
    }
  }
  return { byKey, wildcards }
}

type CrossFire = { reaction: Reaction; entry: CustomEventsRuntimeEntry }

/**
 * Runs a batch listener against a journal-backed draft. Sync listeners
 * commit once when they return; async ones keep the journal open across
 * awaits, committing at every microtask boundary. Cascades are linear: the
 * session-wide visited set fires each reaction at most once — a write that
 * routes back to an already-fired reaction only updates its detail.
 */
function runBatch(
  batchFn: BatchFn<EventDetails>,
  type: string,
  detail: unknown,
  live: EventDetails,
  batchNames: ReadonlySet<string>,
  sessionRef: BatchSessionRef,
  deferred: DeferredQueue,
  dispatchEntries: (entries: CustomEventsRuntimeEntry[]) => Promise<unknown>,
  cross?: {
    index: ReactionIndex
    /** Session-wide visited set: inline firings register here too, so their
     * echo generations are pruned. */
    suppress?: Set<Reaction>
    fire: (reaction: Reaction, receiver: unknown, event: EventSourceEvent) => unknown
    runs: Promise<unknown>[]
  },
): { entries: CustomEventsRuntimeEntry[]; settle?: Promise<void> } {
  let reactionRuns = cross?.runs ?? []
  let previousSession = sessionRef.current
  let session: NonNullable<BatchSessionRef['current']> = { dirty: false }
  // A nested session reads the committed composite: flush any uncommitted
  // parent mutations first, so this session opens on top of them.
  previousSession?.flushNow?.()
  sessionRef.current = session
  let { journal, root } = createJournal(live as object, batchNames)
  // The visited set: one entry per reaction per session. The inline path's
  // suppress set IS this set when provided.
  let fired = cross?.suppress ?? new Set<Reaction>()
  /** Async continuations opened by cross-fired reactions in this session. */
  let crossRuns: Promise<unknown>[] = []
  let active = true
  let flushScheduled = false
  let asyncMode = false
  let flushed: Array<Promise<unknown>> = []
  let sliceEntries: CustomEventsRuntimeEntry[] = []
  let queue: CrossFire[] = []

  let flush = (): Array<Promise<void>> => {
    flushScheduled = false
    if (!active) return []
    let entries = commitJournal(journal, live)
    session.dirty = false
    if (entries.length > 0) {
      if (asyncMode) flushed.push(dispatchEntries(entries))
      else sliceEntries.push(...entries)
    }
    if (cross && entries.length > 0) {
      for (let entry of entries) {
        let matched = [
          ...(cross.index.byKey.get(entry.type) ?? []),
          ...cross.index.wildcards,
        ]
        for (let reaction of matched) {
          if (fired.has(reaction)) continue
          let routed =
            reaction.path.length === 0 ||
            (entry.addresses ?? []).some((address) => {
              let shared = address.length
              for (let i = 0; i < address.length && i < reaction.path.length; i++) {
                if (!Object.is(address[i], reaction.path[i])) {
                  shared = i
                  break
                }
              }
              return shared === address.length || shared === reaction.path.length
            })
          if (!routed) continue
          fired.add(reaction)
          queue.push({ reaction, entry })
        }
      }
      while (queue.length > 0) {
        let { reaction, entry } = queue.shift()!
        let currentAtPath = walkProxy(root, [entry.type, ...reaction.path])
        let returned = cross.fire(
          reaction,
          reaction.path.length === 0 ? root : currentAtPath,
          { type: entry.type, detail: readPath(Reflect.get(root, entry.type), reaction.path) },
        )
        if (returned instanceof Promise) crossRuns.push(returned)
      }
    }
    let deferredCompletions = deferred.drain()
    if (asyncMode) flushed.push(...deferredCompletions)
    return deferredCompletions
  }
  session.flushNow = () => void flush()
  let scheduleFlush = () => {
    if (flushScheduled || !active) return
    flushScheduled = true
    queueMicrotask(flush)
  }
  // Every journal write flags the session dirty and schedules a microtask
  // flush; async listeners mutate between awaits and get each generation
  // committed at its boundary.
  journal.onWrite = () => {
    session.dirty = true
    scheduleFlush()
  }

  // Drain loops until a flush commits nothing new. Fired reactions' writes
  // still reopen generations (derived slices must land); the visited set
  // keeps the cascade linear.
  let drain = (): Array<Promise<void>> => {
    let completions: Array<Promise<void>> = []
    while (true) {
      completions.push(...flush())
      if (!session.dirty) break
    }
    return completions
  }

  let result = batchFn(detail, root as Draft<EventDetails>)
  if (result instanceof Promise || reactionRuns.length > 0 || crossRuns.length > 0) {
    let entries: CustomEventsRuntimeEntry[]
    if (result instanceof Promise) {
      asyncMode = true
      entries = [{ type, detail }]
    } else {
      drain()
      entries = sliceEntries
      asyncMode = true
    }
    let settle = (async () => {
      await Promise.all([result, ...reactionRuns].filter(Boolean))
      // Cross-write reactions chain follow-up generations; drain them here
      // so every derived slice commits before the settle resolves.
      drain()
      // Async cross-fired continuations (gated effects) keep committing.
      while (crossRuns.length > 0) {
        let pending = crossRuns.splice(0)
        await Promise.all(pending.filter(Boolean))
        drain()
      }
      active = false
      sessionRef.current = previousSession
      await Promise.all(flushed)
    })()
    return { entries, settle }
  }
  let deferredCompletions = drain()
  if (crossRuns.length > 0) {
    // Cross-fire opened async continuations after the sync body: keep the
    // session alive until they settle so their writes commit.
    let crossEntries = sliceEntries
    let settle = (async () => {
      while (crossRuns.length > 0) {
        let pending = crossRuns.splice(0)
        await Promise.all(pending.filter(Boolean))
        drain()
      }
      active = false
      sessionRef.current = previousSession
    })()
    return { entries: crossEntries, settle }
  }
  active = false
  sessionRef.current = previousSession
  if (deferredCompletions.length > 0) {
    return {
      entries: sliceEntries,
      settle: Promise.all(deferredCompletions).then(() => {}),
    }
  }
  return { entries: sliceEntries }
}

/**
 * A registered session reaction: its source's type and path, and the
 * callback the runner invokes inside the dispatch session with `this` bound
 * to the value at the path (or the session for the field itself).
 */
type Reaction = {
  type: string
  path: readonly unknown[]
  callback: (event: EventSourceEvent, signal?: AbortSignal) => unknown
}

/**
 * The reaction namespace over a descriptor's event sources: calling a source
 * with a callback registers a reaction instead of an element effect. Nested
 * accessors recurse, so deep paths register against the value at that
 * address.
 */
function createReactionNamespace(descriptorOn: object, reactions: Reaction[]): object {
  let wrapSource = (source: object): object =>
    new Proxy(source, {
      apply(_target, _thisArg, args) {
        let protocol = getEventedSource(_target)
        if (protocol) {
          reactions.push({
            type: protocol.type,
            path: protocol.path ?? [],
            callback: args[0] as (event: EventSourceEvent) => unknown,
          })
          return undefined
        }
        let result = Reflect.apply(_target as (...args: unknown[]) => unknown, _thisArg, args)
        return result !== null &&
          (typeof result === 'object' || typeof result === 'function')
          ? wrapSource(result)
          : result
      },
      get(target, property, receiver) {
        let value = Reflect.get(target, property, receiver)
        if (
          property !== CUSTOM_EVENTS_SOURCE &&
          value !== null &&
          (typeof value === 'object' || typeof value === 'function')
        ) {
          return wrapSource(value)
        }
        return value
      },
    })
  return new Proxy(descriptorOn, {
    get(target, property, receiver) {
      if (property === '*') {
        return (callback: (event: EventSourceEvent) => unknown) => {
          reactions.push({ type: ALL_EVENTS, path: [], callback })
        }
      }
      let value = Reflect.get(target, property, receiver)
      return value !== null && typeof value === 'function' ? wrapSource(value) : value
    },
  })
}

/**
 * The shared batch dispatcher: batch listeners run through a journal
 * session; field writes with registered reactions run inline first, then
 * everything rides one carrier.
 */
function createBatchEntry(args: {
  batchFns: Map<string, BatchFn<EventDetails>>
  live: () => EventDetails
  sessionRef: BatchSessionRef
  deferred: DeferredQueue
  reactions: Reaction[]
  context: RememberedEventContext
}): RememberedEventContext['fold'] {
  let { batchFns, live, sessionRef, deferred, reactions, context } = args

  let reactionIndex: ReactionIndex | undefined
  let reactionIndexFor = (): ReactionIndex =>
    (reactionIndex ??= buildReactionIndex(reactions))
  let reactionSignals = new Map<Reaction, AbortController>()

  function gateWrites(receiver: unknown, signal: AbortSignal): unknown {
    if (receiver === null || typeof receiver !== 'object') return receiver
    return new Proxy(receiver as object, {
      get: (target, property, r) => {
        const value = Reflect.get(target, property, r)
        if (typeof value === 'function' && (target instanceof Map || target instanceof Set)) {
          return value.bind(target)
        }
        return value
      },
      set: (target, property, value) => {
        if (signal.aborted) return true
        return Reflect.set(target, property, value)
      },
      deleteProperty: (target, property) => {
        if (signal.aborted) return true
        return Reflect.deleteProperty(target, property)
      },
      defineProperty: (target, property, descriptor) => {
        if (signal.aborted) return true
        return Reflect.defineProperty(target, property, descriptor)
      },
    })
  }

  function trackRun(result: unknown, signal: AbortSignal): unknown {
    if (!(result instanceof Promise)) return result
    return result.catch((error) => {
      if (signal.aborted || (error as Error)?.name === 'AbortError') return
      throw error
    })
  }

  let fireWithSignal = (
    reaction: Reaction,
    receiver: unknown,
    event: EventSourceEvent,
    owner?: AbortSignal,
  ) => {
    let current = reactionSignals.get(reaction)
    if (owner !== undefined && owner === current?.signal) {
      let gated = gateWrites(receiver, current.signal)
      return trackRun(
        reaction.callback.call(gated, event, current.signal),
        current.signal,
      )
    }
    current?.abort()
    let controller = new AbortController()
    reactionSignals.set(reaction, controller)
    let gated = gateWrites(receiver, controller.signal)
    return trackRun(
      reaction.callback.call(gated, event, controller.signal),
      controller.signal,
    )
  }

  let runFieldReactions = (type: string, detail: unknown, owner?: AbortSignal) => {
    let index = reactionIndexFor()
    let fieldReactions = [
      ...(index.byKey.get(type) ?? []),
      ...index.wildcards,
    ]
    if (fieldReactions.length === 0 || !Object.hasOwn(live(), type)) return
    // Inline firings join the session-wide visited set, so their echo
    // generations never re-run them.
    let fired = new Set<Reaction>()
    let runs: Array<Promise<unknown>> = []
    let session = runBatch(
      (value, draft) => {
        let previous = live()[type]
        if (!Object.is(previous, value)) draft[type] = value
        for (let reaction of fieldReactions) {
          let currentAtPath = readPath(draft[type], reaction.path)
          let previousAtPath = readPath(previous, reaction.path)
          let changed =
            reaction.path.length === 0
              ? !Object.is(previous, value)
              : !Object.is(previousAtPath, currentAtPath)
          if (!changed) continue
          fired.add(reaction)
          let receiver =
            reaction.path.length === 0
              ? draft
              : walkProxy(Reflect.get(draft, type), reaction.path)
          let returned = fireWithSignal(
            reaction,
            receiver,
            { type, detail: currentAtPath },
            owner,
          )
          if (returned instanceof Promise) runs.push(returned)
        }
      },
      type,
      detail,
      live(),
      new Set(batchFns.keys()),
      sessionRef,
      deferred,
      (entries) => context.dispatchEntries!(entries),
      {
        index: reactionIndexFor(),
        suppress: fired,
        fire: (reaction, receiver, event) => fireWithSignal(reaction, receiver, event, owner),
        runs,
      },
    )
    let entries = session.entries
    let addresses = entries.flatMap((entry) => entry.addresses ?? [])
    entries.unshift({
      type,
      detail,
      ...(addresses.length > 0 ? { addresses } : {}),
    })
    if (session.settle) return { entries, settle: session.settle }
    return entries
  }

  return (type: string, detail: unknown, owner?: AbortSignal) => {
    let batchFn = batchFns.get(type)
    if (batchFn) {
      let runs: Array<Promise<unknown>> = []
      let session = runBatch(
        batchFn,
        type,
        detail,
        live(),
        new Set(batchFns.keys()),
        sessionRef,
        deferred,
        (entries) => context.dispatchEntries!(entries),
        {
          index: reactionIndexFor(),
          fire: (reaction, receiver, event) => fireWithSignal(reaction, receiver, event, owner),
          runs,
        },
      )
      let entries = session.entries
      let addresses = entries.flatMap((entry) => entry.addresses ?? [])
      entries.unshift({
        type,
        detail,
        ...(addresses.length > 0 ? { addresses } : {}),
      })
      if (session.settle) return { entries, settle: session.settle }
      return entries
    }

    // A function-valued own field that is not a listener (an arrow helper)
    // is dispatched as a transient occurrence, never a slice replace.
    if (typeof (live() as Record<string, unknown>)[type] === 'function') {
      return [{ type, detail }]
    }

    // A detail dispatch is the implicit replace; a field with registered
    // reactions runs as one session first.
    if (Object.hasOwn(live(), type)) {
      let reacted = runFieldReactions(type, detail, owner)
      if (reacted) return reacted
      let previous = live()[type]
      if (Object.is(previous, detail)) return []
      live()[type] = detail
      return [{ type, detail, addresses: sliceAddresses(previous, detail) }]
    }
    return undefined
  }
}

/**
 * Defines a composite: `class GameEvents extends Events {}` plus
 * `GameEvents.define()`. The class carries only the static — its instance
 * side stays empty, so the composite keeps the subclass's own fields as
 * slices, its methods as batch listeners, and the constructor's `api`
 * registers session effects (`api.on.<slice>(callback)`).
 */
export class Events {
  static define<X extends object, Args extends unknown[]>(
    this: new (api: EventsApi<X>, ...args: Args) => X,
    ...args: Args
  ): CustomEventsDefined<X> {
    return defineEvents(this, ...args)
  }
}

function defineEvents<X extends object, Args extends unknown[]>(
  Class: new (api: EventsApi<X>, ...args: Args) => X,
  ...args: Args
): CustomEventsDefined<X> {
  let instance: X | undefined
  let live = (): EventDetails => instance as unknown as EventDetails

  // Collect the listener methods from the class prototype. The class is
  // plain: nothing is reserved, so every function is a batch listener.
  let batchFns = new Map<string, BatchFn<EventDetails>>()
  let prototype = Class.prototype as { [key: string]: unknown }
  for (let name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue
    let value = prototype[name]
    if (typeof value === 'function') {
      let method = value as (this: unknown, ...args: unknown[]) => unknown
      batchFns.set(
        name,
        ((detail, draft) => method.call(draft, detail)) as BatchFn<EventDetails>,
      )
    }
  }

  let sessionRef: BatchSessionRef = { current: undefined }
  let deferred = createDeferredQueue()
  let pendingSession = () => sessionRef.current?.dirty === true
  let occurrenceKeys = () => new Set<string>(batchFns.keys())
  let reactions: Reaction[] = []
  let context: RememberedEventContext = {
    getState: live,
    fold: () => undefined,
    pendingSession,
    deferDispatch: deferred.defer,
    occurrenceKeys,
  }
  context.fold = createBatchEntry({ batchFns, live, sessionRef, deferred, reactions, context })
  let descriptor = createCustomEventsDescriptor<EventDetails, EventDetails>(context)
  let api = {
    on: createReactionNamespace(descriptor.on as unknown as object, reactions),
    create: descriptor.create,
  } as unknown as EventsApi<X>

  instance = new Class(api, ...args)
  // Listener shadows: invoking a listener field dispatches under its name.
  for (let name of batchFns.keys()) {
    Object.defineProperty(instance, name, {
      value: (detail: unknown) => {
        void (descriptor.dispatchEvent as (input: never) => unknown)({ [name]: detail } as never)
      },
      writable: true,
      configurable: true,
    })
  }

  return descriptor as unknown as CustomEventsDefined<X>
}

function sliceAddresses(previous: unknown, next: unknown): Array<readonly unknown[]> {
  if (isPrimitive(previous) && isPrimitive(next)) {
    let addresses: Array<readonly unknown[]> = []
    if (previous !== undefined && previous !== null) {
      addresses.push([canonicalAddressSegment(previous)])
    }
    if (next !== undefined && next !== null) {
      addresses.push([canonicalAddressSegment(next)])
    }
    return addresses
  }
  if (previous instanceof Set || next instanceof Set) {
    return [[canonicalAddressSegment(next)]]
  }
  return [[]]
}

function isPrimitive(value: unknown) {
  return value === null || typeof value !== 'object'
}
