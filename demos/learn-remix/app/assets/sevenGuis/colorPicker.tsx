import { clientEntry, css, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
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

export const ColorPicker = clientEntry(import.meta.url, function ColorPicker() {
  let events = customEvents(
    {
      hex: '#000000',
      red: '0',
      green: '0',
      blue: '0',
      hue: '0',
      saturation: '0',
      lightness: '0',

      // Each fold shadows its slice. The hex fold derives every channel from
      // its own input; a channel fold derives the hex and the other channels,
      // cross-reading its siblings — so the composite can never hold a
      // contradictory color. A fold only derives when its whole input parses;
      // invalid input leaves the last good model alone.
    },
    {
      hex: (value: string, detail) => {
        detail.hex = value
        let color = parseHex(value)
        if (color) apply(detail, color)
      },
      red: (value: string, detail) => {
        detail.red = value
        let red = parseChannel(value, 255)
        let green = parseChannel(detail.green, 255)
        let blue = parseChannel(detail.blue, 255)
        if (red === undefined || green === undefined || blue === undefined) return
        apply(detail, { red, green, blue })
      },
      green: (value: string, detail) => {
        detail.green = value
        let red = parseChannel(detail.red, 255)
        let green = parseChannel(value, 255)
        let blue = parseChannel(detail.blue, 255)
        if (red === undefined || green === undefined || blue === undefined) return
        apply(detail, { red, green, blue })
      },
      blue: (value: string, detail) => {
        detail.blue = value
        let red = parseChannel(detail.red, 255)
        let green = parseChannel(detail.green, 255)
        let blue = parseChannel(value, 255)
        if (red === undefined || green === undefined || blue === undefined) return
        apply(detail, { red, green, blue })
      },
      hue: (value: string, detail) => {
        detail.hue = value
        let hue = parseChannel(value, 360)
        let saturation = parseChannel(detail.saturation, 100)
        let lightness = parseChannel(detail.lightness, 100)
        if (hue === undefined || saturation === undefined || lightness === undefined) return
        apply(detail, hslToRgb(hue, saturation, lightness))
      },
      saturation: (value: string, detail) => {
        detail.saturation = value
        let hue = parseChannel(detail.hue, 360)
        let saturation = parseChannel(value, 100)
        let lightness = parseChannel(detail.lightness, 100)
        if (hue === undefined || saturation === undefined || lightness === undefined) return
        apply(detail, hslToRgb(hue, saturation, lightness))
      },
      lightness: (value: string, detail) => {
        detail.lightness = value
        let hue = parseChannel(detail.hue, 360)
        let saturation = parseChannel(detail.saturation, 100)
        let lightness = parseChannel(value, 100)
        if (hue === undefined || saturation === undefined || lightness === undefined) return
        apply(detail, hslToRgb(hue, saturation, lightness))
      },
    },
  )
  function apply(
    detail: {
      hex: string
      red: string
      green: string
      blue: string
      hue: string
      saturation: string
      lightness: string
    },
    color: Color,
  ) {
    let hsl = rgbToHsl(color)
    detail.hex = rgbToHex(color)
    detail.red = formatChannel(color.red)
    detail.green = formatChannel(color.green)
    detail.blue = formatChannel(color.blue)
    detail.hue = formatHue(hsl.hue)
    detail.saturation = formatChannel(hsl.saturation)
    detail.lightness = formatChannel(hsl.lightness)
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
                      events.dispatchEvent({
                        [channel]: currentTarget.value,
                      } as Record<(typeof channel)[number], string>)
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
                      events.dispatchEvent({
                        [channel]: currentTarget.value,
                      } as Record<(typeof channel)[number], string>)
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
