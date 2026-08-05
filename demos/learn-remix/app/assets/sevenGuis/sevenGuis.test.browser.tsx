import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { render, type RenderResult } from 'remix/ui/test'
import { SevenGuisCells } from './cells.tsx'
import { SevenGuisCircleDrawer } from './circleDrawer.tsx'
import { SevenGuisCounter } from './counter.tsx'
import { SevenGuisCrud } from './crud.tsx'
import { SevenGuisFlightBooker } from './flightBooker.tsx'
import { KeyedSelection } from './keyedSelection.tsx'
import { SevenGuisTemperatureConverter } from './temperatureConverter.tsx'
import { SevenGuisTimer } from './timer.tsx'

async function settle(result: RenderResult) {
  await result.act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('7GUIs custom-event choreography', () => {
  it('updates the selected identity and re-renders only the losing and gaining options', async (t) => {
    let result = render(<KeyedSelection />)
    t.after(() => result.cleanup())

    let alpha = result.$('button[aria-label="Alpha"]') as HTMLButtonElement
    let bravo = result.$('button[aria-label="Bravo"]') as HTMLButtonElement
    let charlie = result.$('button[aria-label="Charlie"]') as HTMLButtonElement
    assert.equal(alpha.getAttribute('aria-pressed'), 'true')
    assert.equal(bravo.getAttribute('aria-pressed'), 'false')
    assert.equal(alpha.dataset.renders, '1')
    assert.equal(bravo.dataset.renders, '1')
    assert.equal(charlie.dataset.renders, '1')

    await result.act(() => bravo.click())
    await settle(result)

    assert.equal(alpha.getAttribute('aria-pressed'), 'false')
    assert.equal(bravo.getAttribute('aria-pressed'), 'true')
    assert.equal(alpha.dataset.renders, '2')
    assert.equal(bravo.dataset.renders, '2')
    assert.equal(charlie.dataset.renders, '1')
    assert.equal(result.$('output')?.textContent, 'bravo')
  })

  it('increments the counter from its seeded value', async (t) => {
    let result = render(<SevenGuisCounter />)
    t.after(() => result.cleanup())

    let button = result.$('button') as HTMLButtonElement
    let display = () => button.querySelector('span')?.textContent ?? ''

    assert.equal(display(), '0')
    for (let index = 0; index < 3; index++) {
      await result.act(() => button.click())
      await settle(result)
    }
    assert.equal(display(), '3')

    let offset = result.$('input[type="number"]') as HTMLInputElement
    await result.act(() => {
      offset.value = '10'
      offset.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await result.act(() => button.click())
    await settle(result)
    assert.equal(display(), '13')
  })

  it('converts temperatures in both directions and leaves invalid input alone', async (t) => {
    let result = render(<SevenGuisTemperatureConverter />)
    t.after(() => result.cleanup())

    let celsius = result.$('[aria-label="Celsius"]') as HTMLInputElement
    await result.act(() => {
      celsius.value = '100'
      celsius.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })

    let fahrenheit = result.$('[aria-label="Fahrenheit"]') as HTMLInputElement
    assert.equal(fahrenheit.value, '212')

    await result.act(() => {
      fahrenheit.value = '32'
      fahrenheit.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    assert.equal((result.$('[aria-label="Celsius"]') as HTMLInputElement).value, '0')

    celsius = result.$('[aria-label="Celsius"]') as HTMLInputElement
    await result.act(() => {
      celsius.value = 'not a number'
      celsius.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    assert.equal((result.$('[aria-label="Fahrenheit"]') as HTMLInputElement).value, '32')
  })

  it('ticks, accepts a duration, and resets the timer', async (t) => {
    let result = render(<SevenGuisTimer />)
    t.after(() => result.cleanup())

    let duration = result.$('input[type="range"]') as HTMLInputElement
    await result.act(() => {
      duration.value = '3'
      duration.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })

    assert.equal((result.$('input[type="range"]') as HTMLInputElement).value, '3')
    assert.match(result.container.textContent ?? '', /3\.0s/)

    await result.act(() => new Promise((resolve) => window.setTimeout(resolve, 150)))
    assert.notEqual(result.$('output')?.textContent, '0.0s elapsed')

    let reset = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reset',
    )!
    await result.act(() => reset.click())
    await settle(result)
    assert.equal(result.$('output')?.textContent, '0.0s elapsed')
  })

  it('validates, enables, and books return flights', async (t) => {
    let result = render(<SevenGuisFlightBooker />)
    t.after(() => result.cleanup())

    let type = result.$('[aria-label="Flight type"]') as HTMLSelectElement
    let returnDate = result.$('[aria-label="Return date"]') as HTMLInputElement
    let confirmation = result.$('output') as HTMLOutputElement

    assert.equal(returnDate.disabled, true)
    assert.equal(confirmation.hidden, true)

    await result.act(() => {
      type.value = 'return flight'
      type.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle(result)

    returnDate = result.$('[aria-label="Return date"]') as HTMLInputElement
    assert.equal(returnDate.disabled, false)

    let startDate = result.$('[aria-label="Start date"]') as HTMLInputElement
    await result.act(() => {
      startDate.value = '2099-01-01'
      startDate.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    returnDate = result.$('[aria-label="Return date"]') as HTMLInputElement
    await result.act(() => {
      returnDate.value = 'not-a-date'
      returnDate.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    returnDate = result.$('[aria-label="Return date"]') as HTMLInputElement
    let book = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Book',
    )!
    assert.equal(returnDate.getAttribute('aria-invalid'), 'true')
    assert.equal(book.disabled, true)

    await result.act(() => {
      returnDate.value = '2099-12-31'
      returnDate.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    book = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Book',
    )!
    let currentReturnDate = result.$('[aria-label="Return date"]') as HTMLInputElement
    assert.equal(currentReturnDate.getAttribute('aria-invalid'), 'false')
    assert.equal(book.disabled, false)

    await result.act(() => book.click())
    await settle(result)
    assert.equal(confirmation.hidden, false)
    assert.match(
      result.container.textContent ?? '',
      /You have booked a return flight from 2099-01-01 to 2099-12-31/,
    )

    await result.act(() => {
      currentReturnDate.value = '2100-12-31'
      currentReturnDate.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)
    assert.match(
      result.container.textContent ?? '',
      /You have booked a return flight from 2099-01-01 to 2099-12-31/,
    )

    await result.act(() => book.click())
    await settle(result)
    assert.match(
      result.container.textContent ?? '',
      /You have booked a return flight from 2099-01-01 to 2100-12-31/,
    )
  })

  it('filters, selects, updates, deletes, and creates people', async (t) => {
    let result = render(<SevenGuisCrud />)
    t.after(() => result.cleanup())

    let filter = result.$('[aria-label="Filter prefix"]') as HTMLInputElement
    let people = result.$('[aria-label="People"]') as HTMLSelectElement

    assert.equal(people.options.length, 3)

    await result.act(() => {
      filter.value = 'M'
      filter.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)
    assert.equal(people.options.length, 1)

    await result.act(() => {
      filter.value = ''
      filter.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)
    assert.equal(people.options.length, 3)

    await result.act(() => {
      people.value = '1'
      people.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle(result)

    let name = result.$('[aria-label="Name"]') as HTMLInputElement
    let surname = result.$('[aria-label="Surname"]') as HTMLInputElement
    assert.equal(name.value, 'Hans')
    assert.equal(surname.value, 'Emil')

    await result.act(() => {
      name.value = 'Hanna'
      name.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    let update = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Update',
    )!
    await result.act(() => update.click())
    await settle(result)
    people = result.$('[aria-label="People"]') as HTMLSelectElement
    assert.equal(people.options[0]?.textContent, 'Emil, Hanna')

    let remove = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Delete',
    )!
    await result.act(() => remove.click())
    await settle(result)

    people = result.$('[aria-label="People"]') as HTMLSelectElement
    name = result.$('[aria-label="Name"]') as HTMLInputElement
    surname = result.$('[aria-label="Surname"]') as HTMLInputElement
    assert.equal(people.options.length, 2)
    assert.equal(name.value, '')
    assert.equal(surname.value, '')

    await result.act(() => {
      name.value = 'Ada'
      name.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)
    surname = result.$('[aria-label="Surname"]') as HTMLInputElement
    await result.act(() => {
      surname.value = 'Lovelace'
      surname.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    let create = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create',
    )!
    assert.equal(create.disabled, false)
    await result.act(() => create.click())
    await settle(result)

    people = result.$('[aria-label="People"]') as HTMLSelectElement
    assert.equal(people.options.length, 3)
    assert.ok(Array.from(people.options).some((option) => option.textContent === 'Lovelace, Ada'))
  })

  it('adds, resizes, closes, undoes, and redoes a circle', async (t) => {
    let result = render(<SevenGuisCircleDrawer />)
    t.after(() => result.cleanup())

    let canvas = result.container.querySelector<SVGSVGElement>('[aria-label="Circle canvas"]')!
    assert.equal((result.container.querySelector('form') as HTMLFormElement).hidden, true)
    assert.equal(getComputedStyle(result.container.querySelector('form')!).display, 'none')
    // The isolated render root is not laid out, unlike the real page. Supply
    // the canvas's view-space dimensions so this test can exercise pointer math.
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 0, 420, 220),
    })

    await result.act(() =>
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 80 })),
    )
    await settle(result)

    assert.equal(result.container.querySelectorAll('circle').length, 1)
    let createdCircle = result.container.querySelector('circle')!
    let cx = Number(createdCircle.getAttribute('cx'))
    let cy = Number(createdCircle.getAttribute('cy'))
    assert.ok(Number.isFinite(cx) && cx >= 0 && cx <= 420)
    assert.ok(Number.isFinite(cy) && cy >= 0 && cy <= 220)
    let undo = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Undo',
    )!
    assert.equal(undo.disabled, false)

    let circle = result.container.querySelector('circle')!
    await result.act(() =>
      circle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    )
    await settle(result)

    canvas = result.container.querySelector<SVGSVGElement>('[aria-label="Circle canvas"]')!
    await result.act(() =>
      canvas.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 400,
          clientY: 200,
        }),
      ),
    )
    await settle(result)

    assert.equal((result.container.querySelector('form') as HTMLFormElement).hidden, false)
    assert.equal(result.container.querySelector('circle')?.getAttribute('fill'), '#d4d4d8')
    let diameter = result.$('form input[type="range"]') as HTMLInputElement
    assert.equal(diameter.value, '30')
    await result.act(() => {
      diameter.value = '60'
      diameter.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)
    assert.equal(result.container.querySelector('circle')?.getAttribute('r'), '30')

    let close = Array.from(
      result.container.querySelectorAll<HTMLButtonElement>('form button'),
    ).find((button) => button.textContent === 'Close')!
    await result.act(() => close.click())
    await settle(result)
    assert.equal((result.container.querySelector('form') as HTMLFormElement).hidden, true)
    assert.equal(result.container.querySelector('circle')?.getAttribute('fill'), 'none')

    await result.act(() => undo.click())
    await settle(result)
    assert.equal(result.container.querySelector('circle')?.getAttribute('r'), '15')

    undo = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Undo',
    )!
    await result.act(() => undo.click())
    await result.act(() => Promise.resolve())
    assert.equal(result.container.querySelectorAll('circle').length, 0)

    let redo = Array.from(result.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Redo',
    )!
    assert.equal(redo.disabled, false)
    await result.act(() => redo.click())
    await settle(result)
    assert.equal(result.container.querySelectorAll('circle').length, 1)
  })

  it('resizes only the addressed circle', async (t) => {
    let result = render(<SevenGuisCircleDrawer />)
    t.after(() => result.cleanup())

    let canvas = result.container.querySelector<SVGSVGElement>('[aria-label="Circle canvas"]')!
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 0, 420, 220),
    })

    await result.act(() =>
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 80, clientY: 80 })),
    )
    await result.act(() =>
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 320, clientY: 160 })),
    )
    await settle(result)

    let circles = result.container.querySelectorAll('circle')
    assert.equal(circles.length, 2)
    let secondCircle = circles[1]
    await result.act(() =>
      circles[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    )
    await settle(result)

    let diameter = result.$('form input[type="range"]') as HTMLInputElement
    await result.act(() => {
      diameter.value = '60'
      diameter.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    circles = result.container.querySelectorAll('circle')
    assert.equal(circles[0].getAttribute('r'), '30')
    assert.equal(circles[1], secondCircle)
    assert.equal(circles[1].getAttribute('r'), '15')

    await result.act(() => {
      diameter.value = '30'
      diameter.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    circles = result.container.querySelectorAll('circle')
    assert.equal(circles[0].getAttribute('r'), '15')
    assert.equal(circles[1], secondCircle)
  })

  it('keeps every cell editable and recalculates formulas', async (t) => {
    let result = render(<SevenGuisCells />)
    t.after(() => result.cleanup())

    let a0 = result.$('input[aria-label="A0"]') as HTMLInputElement
    let c0 = result.$('input[aria-label="C0"]') as HTMLInputElement
    assert.ok(a0, 'A0 should render as an input')
    assert.ok(c0, 'C0 should render as an input')
    assert.equal(a0.value, '10')
    assert.equal(c0.value, '30')

    await result.act(() => c0.focus())
    await settle(result)
    assert.equal(c0.value, '=A0+B0')
    await result.act(() => c0.blur())
    await settle(result)
    assert.equal(c0.value, '30')

    await result.act(() => a0.focus())
    await settle(result)
    await result.act(() => {
      a0.value = '15'
      a0.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    c0 = result.$('input[aria-label="C0"]') as HTMLInputElement
    assert.ok(c0, 'C0 should remain rendered while A0 is edited')
    assert.equal(c0.value, '30')

    await result.act(() => a0.blur())
    await settle(result)
    c0 = result.$('input[aria-label="C0"]') as HTMLInputElement
    assert.ok(c0, 'C0 should remain rendered after recalculation')
    assert.equal(c0.value, '35')

    await result.act(() => {
      a0.focus()
      a0.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    assert.equal(document.activeElement, a0)

    let platformModifier = navigator.platform.startsWith('Mac')
      ? { metaKey: true }
      : { ctrlKey: true }
    await result.act(() =>
      a0.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          shiftKey: true,
          ...platformModifier,
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    let b0 = result.$('input[aria-label="B0"]') as HTMLInputElement
    assert.equal(document.activeElement, b0)

    await result.act(() =>
      b0.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          shiftKey: true,
          ...platformModifier,
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    let b1 = result.$('input[aria-label="B1"]') as HTMLInputElement
    assert.equal(document.activeElement, b1)
  })

  it('rerenders only cells whose calculated values are patched', async (t) => {
    let result = render(<SevenGuisCells />)
    t.after(() => result.cleanup())

    let cell = (id: string) => result.$(`input[aria-label="${id}"]`) as HTMLInputElement
    let renderCount = (id: string) => Number(cell(id).dataset.renderCount)
    let a0 = cell('A0')

    await result.act(() => a0.focus())
    await settle(result)
    await result.act(() => {
      a0.value = '15'
      a0.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await settle(result)

    let before = Object.fromEntries(['A0', 'B0', 'C0', 'D0'].map((id) => [id, renderCount(id)]))

    await result.act(() => a0.blur())
    await settle(result)

    assert.equal(renderCount('A0'), before.A0! + 1)
    assert.equal(renderCount('C0'), before.C0! + 1)
    assert.equal(renderCount('B0'), before.B0)
    assert.equal(renderCount('D0'), before.D0)
  })
})
