import { Fragment } from './component.ts'
import { Frame } from './component.ts'
import { invariant } from './invariant.ts'
import { isEmptyChild, isPrimitiveChild, isRemixNode, normalizeChildren } from './core/children.ts'
import type { EventSourceEvent } from './event-source.ts'
import type { RemixNode } from './jsx.ts'
import type { ElementFunction } from './element-function.ts'
import type { FrameProps } from './component.ts'
import { isMixinDescriptor } from './mixins/mixin.ts'
import { LIST_TAG } from './vnode.ts'
import {
  isRemixElement,
  NON_RENDER_NODE,
  TEXT_NODE,
  type RuntimeElementProps,
  type RuntimeHostProps,
  type VNodeInput,
} from './vnode.ts'

function flatMapChildrenToVNodes(props: RuntimeHostProps): VNodeInput[] {
  let children = props.children
  if (children === undefined) return []
  if (!Array.isArray(children)) return [toVNode(children)]
  let vnodes: VNodeInput[] = []
  flattenChildrenToVNodes(children, vnodes)
  return vnodes
}

/**
 * Resolves the children of an event-aware host element: a function child is
 * called with the callback input and the matched event, static children pass
 * through. Used when the element (re-)renders from an event rather than a
 * parent render.
 *
 * @param children Raw children value from the element props.
 * @param input The callback input.
 * @param event The matched event, when the element is occurrence-driven.
 * @returns The resolved child vnodes.
 */
export function resolveEventedChildInputs(
  children: unknown,
  input: unknown,
  event?: EventSourceEvent,
): VNodeInput[] {
  let resolved = typeof children === 'function' ? children(input, event) : children
  if (resolved === undefined || resolved === null) return []
  invariant(isRemixNode(resolved), 'Invalid host children')
  return flatMapChildrenToVNodes({ children: resolved })
}

function flattenChildrenToVNodes(nodes: RemixNode[], out: VNodeInput[]): void {
  let children = normalizeChildren(nodes)
  for (let i = 0; i < children.length; i++) {
    out.push(toVNode(children[i]))
  }
}

/**
 * Resolves the children of a keyed list element: the per-item template is
 * called with each collection item and its key. Used when the element
 * (re-)renders from an event rather than a parent render.
 *
 * @param template The per-item template child.
 * @param input The callback input; must be a Map, Set, or array.
 * @returns The resolved child vnodes plus parallel item/key references.
 */
export function resolveEventedListItemInputs(
  template: unknown,
  input: unknown,
): { vnodes: VNodeInput[]; items: unknown[]; keys: unknown[] } {
  let detail = input
  if (detail === undefined || detail === null) {
    return { vnodes: [], items: [], keys: [] }
  }
  let render = template as (item: unknown, key: unknown) => RemixNode
  let vnodes: VNodeInput[] = []
  let items: unknown[] = []
  let keys: unknown[] = []
  if (detail instanceof Map) {
    for (let [key, item] of detail) {
      vnodes.push(toVNode(renderItem(render, item, key)))
      items.push(item)
      keys.push(key)
    }
    return { vnodes, items, keys }
  }
  if (detail instanceof Set) {
    for (let item of detail) {
      vnodes.push(toVNode(renderItem(render, item, item)))
      items.push(item)
      keys.push(item)
    }
    return { vnodes, items, keys }
  }
  if (Array.isArray(detail)) {
    for (let index = 0; index < detail.length; index++) {
      vnodes.push(toVNode(renderItem(render, detail[index], index)))
      items.push(detail[index])
      keys.push(index)
    }
    return { vnodes, items, keys }
  }
  invariant(false, '<list> requires an event detail that is a Map, Set, or array.')
}

function renderItem(
  render: (item: unknown, key: unknown) => RemixNode,
  item: unknown,
  key: unknown,
): RemixNode {
  let rendered = render(item, key)
  invariant(
    rendered !== null && rendered !== undefined,
    '<list> item templates must render a node for every item',
  )
  return rendered
}

export function toVNode(node: RemixNode): VNodeInput {
  if (isEmptyChild(node)) {
    return { kind: 'empty', type: NON_RENDER_NODE }
  }

  if (isPrimitiveChild(node)) {
    return { kind: 'text', type: TEXT_NODE, _text: String(node) }
  }

  if (isRemixElement(node)) {
    if (node.type === Fragment) {
      let props = parseHostProps(node.props)
      return {
        kind: 'fragment',
        type: Fragment,
        key: node.key,
        _children: flatMapChildrenToVNodes(props),
      }
    }

    if (node.type === Frame) {
      invariant(isFrameProps(node.props), '<Frame /> requires a src prop')
      return { kind: 'frame', type: Frame, key: node.key, props: node.props }
    }

    if (typeof node.type === 'string') {
      if (node.type === LIST_TAG) {
        let props = node.props
        invariant(
          props.eventSource != null && typeof props.children === 'function',
          '<list> requires an eventSource prop and a function child that renders each item',
        )
        return { kind: 'list', type: LIST_TAG, key: node.key, props }
      }
      let props = parseHostProps(node.props)
      // Event-aware elements resolve their children from the event input at
      // commit time instead of converting them here.
      let evented = props.eventSource != null
      // When innerHTML is set, ignore children
      let children = props.innerHTML != null || evented ? [] : flatMapChildrenToVNodes(props)
      return {
        kind: 'host',
        type: node.type,
        key: node.key,
        props,
        _children: children,
      }
    }
    invariant(isElementFunction(node.type), 'Expected component element type')
    return { kind: 'component', type: node.type, key: node.key, props: node.props }
  }

  if (Array.isArray(node)) {
    let children: VNodeInput[] = []
    flattenChildrenToVNodes(node, children)
    return { kind: 'fragment', type: Fragment, _children: children }
  }

  invariant(false, 'Unexpected RemixNode')
}

function isFrameProps(props: RuntimeElementProps): props is RuntimeElementProps & FrameProps {
  return typeof props.src === 'string' && props.src.length > 0
}

function parseHostProps(props: RuntimeElementProps): RuntimeHostProps {
  let children = props.children
  let evented = props.eventSource != null
  invariant(
    children === undefined || isRemixNode(children) || (evented && typeof children === 'function'),
    'Invalid host children',
  )

  let innerHTML = props.innerHTML
  invariant(innerHTML === undefined || typeof innerHTML === 'string', 'Invalid innerHTML prop')

  let mix = props.mix
  invariant(mix === undefined || isRuntimeMixValue(mix), 'Invalid mix prop')
  return props
}

function isRuntimeMixValue(value: unknown): value is RuntimeHostProps['mix'] {
  if (!Array.isArray(value)) return isMixinDescriptor(value)
  for (let descriptor of value) {
    if (!isMixinDescriptor(descriptor)) return false
  }
  return true
}

function isElementFunction(value: unknown): value is ElementFunction {
  return typeof value === 'function'
}
