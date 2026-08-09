import * as assert from '@remix-run/assert'
import { describe, it } from '@remix-run/test'

import { decodeListRoutes, listRoutesMatchDetail, type EventRoutes } from './event-route.ts'

function routes(addresses: readonly (readonly unknown[])[], ops: EventRoutes['ops']): EventRoutes {
  return { addresses, ops }
}

describe('decodeListRoutes', () => {
  it('falls back without routes or with a misaligned route list', () => {
    let items = ['a', 'b']
    assert.deepEqual(decodeListRoutes(['a', 'b'], items, [0, 1], undefined), [{ op: 'fallback' }])
    assert.deepEqual(
      decodeListRoutes(['a', 'b'], items, [0, 1], routes([['0']], ['add', 'remove'])),
      [{ op: 'fallback' }],
    )
  })

  it('falls back for non-collection details', () => {
    assert.deepEqual(decodeListRoutes({ a: 1 }, [], [], routes([[]], ['replace'])), [
      { op: 'fallback' },
    ])
  })

  describe('Map', () => {
    let detail = new Map([
      ['a', 1],
      ['b', 2],
    ])

    it('inserts a new key at its iteration position', () => {
      let next = new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ])
      assert.deepEqual(decodeListRoutes(next, ['a', 'b'], ['a', 'b'], routes([['c']], ['add'])), [
        { op: 'insert', index: 2, item: 3, key: 'c' },
      ])
    })

    it('removes a deleted key', () => {
      assert.deepEqual(
        decodeListRoutes(detail, ['a', 'b'], ['a', 'b'], routes([['b']], ['remove'])),
        [{ op: 'remove', index: 1 }],
      )
    })

    it('rebuilds a replaced value', () => {
      let next = new Map([
        ['a', 10],
        ['b', 2],
      ])
      assert.deepEqual(decodeListRoutes(next, [1, 2], ['a', 'b'], routes([['a']], ['replace'])), [
        { op: 'rebuild', index: 0, item: 10, key: 'a' },
      ])
    })

    it('matches numeric keys through string addresses', () => {
      let next = new Map([
        [1, { id: 1 }],
        [2, { id: 2 }],
        [3, { id: 3 }],
      ])
      assert.deepEqual(
        decodeListRoutes(next, [{ id: 1 }, { id: 2 }], [1, 2], routes([['3']], ['add'])),
        [{ op: 'insert', index: 2, item: { id: 3 }, key: 3 }],
      )
    })

    it('falls back for whole-key addresses and unknown keys', () => {
      assert.deepEqual(
        decodeListRoutes(detail, ['a', 'b'], ['a', 'b'], routes([[]], ['replace'])),
        [{ op: 'fallback' }],
      )
      assert.deepEqual(
        decodeListRoutes(detail, ['a', 'b'], ['a', 'b'], routes([['z']], ['remove'])),
        [{ op: 'fallback' }],
      )
      assert.deepEqual(decodeListRoutes(detail, ['a', 'b'], ['a', 'b'], routes([['z']], ['add'])), [
        { op: 'fallback' },
      ])
    })

    it('falls back for deep addresses', () => {
      assert.deepEqual(
        decodeListRoutes(detail, ['a', 'b'], ['a', 'b'], routes([['a', 'length']], ['replace'])),
        [{ op: 'fallback' }],
      )
    })
  })

  describe('Set', () => {
    it('inserts and removes by value', () => {
      let detail = new Set(['red', 'green'])
      let next = new Set(['red', 'green', 'blue'])
      assert.deepEqual(
        decodeListRoutes(next, ['red', 'green'], ['red', 'green'], routes([['blue']], ['add'])),
        [{ op: 'insert', index: 2, item: 'blue', key: 'blue' }],
      )
      assert.deepEqual(
        decodeListRoutes(
          detail,
          ['red', 'green'],
          ['red', 'green'],
          routes([['green']], ['remove']),
        ),
        [{ op: 'remove', index: 1 }],
      )
    })
  })

  describe('Array', () => {
    let items = ['a', 'b', 'c']

    it('inserts a pushed item', () => {
      assert.deepEqual(
        decodeListRoutes(['a', 'b', 'c', 'd'], items, [0, 1, 2], routes([['3']], ['add'])),
        [{ op: 'insert', index: 3, item: 'd', key: 3 }],
      )
    })

    it('removes a popped item', () => {
      assert.deepEqual(
        decodeListRoutes(['a', 'b'], items, [0, 1, 2], routes([['2']], ['remove'])),
        [{ op: 'remove', index: 2 }],
      )
    })

    it('rebuilds an index-set', () => {
      assert.deepEqual(
        decodeListRoutes(['a', 'Z', 'c'], items, [0, 1, 2], routes([['1']], ['replace'])),
        [{ op: 'rebuild', index: 1, item: 'Z', key: 1 }],
      )
    })

    it('decodes a splice-remove chain into a single remove', () => {
      // Immer patches for `splice(1, 1)`: replace [1]=c, remove [2].
      assert.deepEqual(
        decodeListRoutes(
          ['a', 'c'],
          items,
          [0, 1, 2],
          routes([['1'], ['2']], ['replace', 'remove']),
        ),
        [{ op: 'remove', index: 1 }],
      )
    })

    it('falls back for splice-insert chains', () => {
      // Immer patches for `splice(1, 0, 'x')`: replace [1]=x, replace [2]=b, add [3]=c.
      assert.deepEqual(
        decodeListRoutes(
          ['a', 'x', 'b', 'c'],
          items,
          [0, 1, 2],
          routes([['1'], ['2'], ['3']], ['replace', 'replace', 'add']),
        ),
        [{ op: 'fallback' }],
      )
    })

    it('falls back for unshift chains', () => {
      // Immer patches for `unshift('z')`: replace [0..2], add [3].
      assert.deepEqual(
        decodeListRoutes(
          ['z', 'a', 'b', 'c'],
          items,
          [0, 1, 2],
          routes([['0'], ['1'], ['2'], ['3']], ['replace', 'replace', 'replace', 'add']),
        ),
        [{ op: 'fallback' }],
      )
    })

    it('falls back for reorders and fills', () => {
      // Immer patches for `reverse()`: replace [0]=c, replace [2]=a.
      assert.deepEqual(
        decodeListRoutes(
          ['c', 'b', 'a'],
          items,
          [0, 1, 2],
          routes([['0'], ['2']], ['replace', 'replace']),
        ),
        [{ op: 'fallback' }],
      )
      // Immer patches for `fill('x')`: replace [0..2].
      assert.deepEqual(
        decodeListRoutes(
          ['x', 'x', 'x'],
          items,
          [0, 1, 2],
          routes([['0'], ['1'], ['2']], ['replace', 'replace', 'replace']),
        ),
        [{ op: 'fallback' }],
      )
    })

    it('skips an add whose slot already holds the value', () => {
      // An add patch that merely re-affirms an existing slot changes nothing.
      assert.deepEqual(
        decodeListRoutes(['a', 'b', 'c'], items, [0, 1, 2], routes([['1']], ['add'])),
        [],
      )
    })

    it('falls back for out-of-range removes and adds', () => {
      assert.deepEqual(
        decodeListRoutes(['a', 'b', 'c'], items, [0, 1, 2], routes([['9']], ['remove'])),
        [],
      )
      assert.deepEqual(
        decodeListRoutes(['a', 'b', 'c'], items, [0, 1, 2], routes([['9']], ['add'])),
        [{ op: 'fallback' }],
      )
    })
  })

  describe('listRoutesMatchDetail', () => {
    let items = ['a', 'b', 'c']
    let mapDetail = new Map([
      ['a', 1],
      ['b', 2],
    ])
    let mapItems = [1, 2]
    let mapKeys = ['a', 'b']

    it('accepts actions that reproduce the collection exactly', () => {
      assert.ok(
        listRoutesMatchDetail(['a', 'c'], ['a', 'b', 'c'], [0, 1, 2], [{ op: 'remove', index: 1 }]),
      )
      assert.ok(
        listRoutesMatchDetail(
          new Map([
            ['a', 1],
            ['b', 2],
            ['d', 3],
          ]),
          mapItems,
          mapKeys,
          [{ op: 'insert', index: 2, item: 3, key: 'd' }],
        ),
      )
    })

    it('rejects actions that miss coalesced changes', () => {
      // A burst of two adds coalesced: the last event's routes cover one.
      assert.ok(
        !listRoutesMatchDetail(
          new Map([
            ['a', 1],
            ['b', 2],
            ['c', 3],
            ['d', 4],
          ]),
          mapItems,
          mapKeys,
          [{ op: 'insert', index: 2, item: 3, key: 'c' }],
        ),
      )
      // A coalesced Map value replace may diverge from the committed item:
      // whole-key subscribers skip Map item replaces, so a nested keyed
      // subscription refreshed the item element directly. Key alignment
      // still guarantees the structural delta is exact.
      assert.ok(
        listRoutesMatchDetail(
          new Map([
            ['a', 9],
            ['b', 5],
          ]),
          mapItems,
          mapKeys,
          [{ op: 'rebuild', index: 0, item: 9, key: 'a' }],
        ),
      )
      // Arrays never skip replaces: a coalesced array value replace
      // diverges from the committed item and must fail the check.
      assert.ok(
        !listRoutesMatchDetail(
          [9, 2, 3],
          items,
          [0, 1, 2],
          [{ op: 'rebuild', index: 0, item: 9, key: 0 }],
        ),
      )
      // A coalesced removal leaves the keys misaligned.
      assert.ok(!listRoutesMatchDetail(['b'], items, [0, 1, 2], [{ op: 'remove', index: 0 }]))
    })

    it('rejects fallbacks and non-collection details', () => {
      assert.ok(!listRoutesMatchDetail(['a', 'b'], items, [0, 1, 2], [{ op: 'fallback' }]))
      assert.ok(!listRoutesMatchDetail({ a: 1 }, [], [], []))
    })
  })
})
