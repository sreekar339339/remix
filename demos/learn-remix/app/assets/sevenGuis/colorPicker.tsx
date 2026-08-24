import { clientEntry, css, on } from 'remix/ui'
import { Events, evented, type EventsApi } from '../utils/customEvents/index.tsx'
import { inputCss, rowCss, taskCss } from './styles.ts'

type Color = {
  red: number
  green: number
  blue: number
}

function parseHex(value: string) {
  let hex = value.trim().replace(/^#/, '')
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function parseChannel(value: string, max: number) {
  if (value.trim() === '') return
  let number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= max ? number : undefined
}

function formatChannel(value: number) {
  return String(Math.round(value))
}

function formatHue(value: number) {
  return String(Math.round(((value % 360) + 360) % 360))
}

function rgbToHsl(color: Color) {
  let red = color.red / 255
  let green = color.green / 255
  let blue = color.blue / 255
  let max = Math.max(red, green, blue)
  let min = Math.min(red, green, blue)
  let lightness = (max + min) / 2
  let delta = max - min
  if (delta === 0) return { hue: 0, saturation: 0, lightness: lightness * 100 }
  let saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  return { hue: hue * 60, saturation: saturation * 100, lightness: lightness * 100 }
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  let h = (((hue % 360) + 360) % 360) / 360
  let s = saturation / 100
  let l = lightness / 100
  if (s === 0) {
    let gray = Math.round(l * 255)
    return { red: gray, green: gray, blue: gray }
  }
  let q = l < 0.5 ? l * (1 + s) : l + s - l * s
  let p = 2 * l - q
  let channel = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return {
    red: Math.round(channel(h + 1 / 3) * 255),
    green: Math.round(channel(h) * 255),
    blue: Math.round(channel(h - 1 / 3) * 255),
  }
}

function rgbToHex(color: Color) {
  let channel = (value: number) => Math.round(value).toString(16).padStart(2, '0')
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`
}

const swatchCss = css({
  width: 48,
  height: 48,
  borderRadius: 8,
  border: '1px solid #d4d4d8',
})

type ColorModel = {
  hex: string
  red: string
  green: string
  blue: string
  hue: string
  saturation: string
  lightness: string
}

function applyColor(model: ColorModel, color: Color) {
  let hsl = rgbToHsl(color)
  model.hex = rgbToHex(color)
  model.red = formatChannel(color.red)
  model.green = formatChannel(color.green)
  model.blue = formatChannel(color.blue)
  model.hue = formatHue(hsl.hue)
  model.saturation = formatChannel(hsl.saturation)
  model.lightness = formatChannel(hsl.lightness)
}

class ColorPickerEvents extends Events {
  hex = '#000000'
  red = '0'
  green = '0'
  blue = '0'
  hue = '0'
  saturation = '0'
  lightness = '0'

  // Reactions own each channel's update: dispatching `{ red: value }`
  // writes the slice and derives the hex and the other channels from the
  // current siblings — so the composite can never hold a contradictory
  // color. A reaction only derives when its whole input parses; invalid
  // input leaves the last good model alone.
  constructor(api: EventsApi<ColorPickerEvents>) {
    super()
    api.on.hex(function ({ detail }) {
      let color = parseHex(detail)
      if (color) applyColor(this, color)
    })
    api.on.red(function ({ detail }) {
      let red = parseChannel(detail, 255)
      let green = parseChannel(this.green, 255)
      let blue = parseChannel(this.blue, 255)
      if (red === undefined || green === undefined || blue === undefined) return
      applyColor(this, { red, green, blue })
    })
    api.on.green(function ({ detail }) {
      let red = parseChannel(this.red, 255)
      let green = parseChannel(detail, 255)
      let blue = parseChannel(this.blue, 255)
      if (red === undefined || green === undefined || blue === undefined) return
      applyColor(this, { red, green, blue })
    })
    api.on.blue(function ({ detail }) {
      let red = parseChannel(this.red, 255)
      let green = parseChannel(this.green, 255)
      let blue = parseChannel(detail, 255)
      if (red === undefined || green === undefined || blue === undefined) return
      applyColor(this, { red, green, blue })
    })
    api.on.hue(function ({ detail }) {
      let hue = parseChannel(detail, 360)
      let saturation = parseChannel(this.saturation, 100)
      let lightness = parseChannel(this.lightness, 100)
      if (hue === undefined || saturation === undefined || lightness === undefined) return
      applyColor(this, hslToRgb(hue, saturation, lightness))
    })
    api.on.saturation(function ({ detail }) {
      let hue = parseChannel(this.hue, 360)
      let saturation = parseChannel(detail, 100)
      let lightness = parseChannel(this.lightness, 100)
      if (hue === undefined || saturation === undefined || lightness === undefined) return
      applyColor(this, hslToRgb(hue, saturation, lightness))
    })
    api.on.lightness(function ({ detail }) {
      let hue = parseChannel(this.hue, 360)
      let saturation = parseChannel(this.saturation, 100)
      let lightness = parseChannel(detail, 100)
      if (hue === undefined || saturation === undefined || lightness === undefined) return
      applyColor(this, hslToRgb(hue, saturation, lightness))
    })
  }
}

export const ColorPicker = clientEntry(import.meta.url, function ColorPicker() {

  let events = ColorPickerEvents.define()
  let setColorChannel = {
    red: (value: string) => events.dispatchEvent({ red: value }),
    green: (value: string) => events.dispatchEvent({ green: value }),
    blue: (value: string) => events.dispatchEvent({ blue: value }),
    hue: (value: string) => events.dispatchEvent({ hue: value }),
    saturation: (value: string) => events.dispatchEvent({ saturation: value }),
    lightness: (value: string) => events.dispatchEvent({ lightness: value }),
  }

  return () => (
    <section mix={taskCss}>
      <h2>Color Picker</h2>
      <div mix={[rowCss, css({ alignItems: 'end', flexWrap: 'wrap' })]}>
        <label>
          Hex{' '}
          <evented.input
            on={events.on.hex}
            aria-label="Hex"
            value={(hex) => hex}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                events.dispatchEvent({ hex: currentTarget.value })
              }),
            ]}
          />
        </label>
        <fieldset mix={css({ border: 'none', margin: 0, padding: 0 })}>
          <legend>RGB</legend>
          <div mix={rowCss}>
            {(
              [
                ['red', 'Red'],
                ['green', 'Green'],
                ['blue', 'Blue'],
              ] as const
            ).map(([channel, label]) => (
              <label>
                {label}{' '}
                <evented.input
                  on={events.on[channel]}
                  aria-label={label}
                  value={(value) => value}
                  mix={[
                    inputCss,
                    on('input', ({ currentTarget }) => {
                      setColorChannel[channel](currentTarget.value)
                    }),
                  ]}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset mix={css({ border: 'none', margin: 0, padding: 0 })}>
          <legend>HSL</legend>
          <div mix={rowCss}>
            {(
              [
                ['hue', 'Hue'],
                ['saturation', 'Saturation'],
                ['lightness', 'Lightness'],
              ] as const
            ).map(([channel, label]) => (
              <label>
                {label}{' '}
                <evented.input
                  on={events.on[channel]}
                  aria-label={label}
                  value={(value) => value}
                  mix={[
                    inputCss,
                    on('input', ({ currentTarget }) => {
                      setColorChannel[channel](currentTarget.value)
                    }),
                  ]}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <evented.div
          on={events.on.hex}
          aria-label="Swatch"
          style={(hex) => ({ background: parseHex(hex) ? hex : '#e4e4e7' })}
          mix={swatchCss}
        />
      </div>
    </section>
  )
})
