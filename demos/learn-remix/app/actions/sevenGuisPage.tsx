import { css } from 'remix/ui'
import { SevenGuisCells } from '../assets/sevenGuis/cells.tsx'
import { SevenGuisCircleDrawer } from '../assets/sevenGuis/circleDrawer.tsx'
import { SevenGuisCounter } from '../assets/sevenGuis/counter.tsx'
import { SevenGuisCrud } from '../assets/sevenGuis/crud.tsx'
import { SevenGuisFlightBooker } from '../assets/sevenGuis/flightBooker.tsx'
import { KeyedSelection } from '../assets/sevenGuis/keyedSelection.tsx'
import { SevenGuisTemperatureConverter } from '../assets/sevenGuis/temperatureConverter.tsx'
import { SevenGuisTimer } from '../assets/sevenGuis/timer.tsx'
import { Layout } from '../ui/layout.tsx'

export function SevenGuisPage() {
  return () => (
    <Layout>
      <section
        mix={css({
          display: 'grid',
          gap: 18,
          width: 'min(980px, 100%)',
          paddingBottom: 48,
        })}
      >
        <header>
          <h1>7GUIs with CustomEvents</h1>
          <p>
            Seven small GUI tasks implemented with native dispatchEvent and the CustomEvents
            descriptor API.
          </p>
        </header>
        <SevenGuisCounter />
        <SevenGuisTemperatureConverter />
        <SevenGuisFlightBooker />
        <SevenGuisTimer />
        <SevenGuisCrud />
        <SevenGuisCircleDrawer />
        <SevenGuisCells />
        <KeyedSelection />
      </section>
    </Layout>
  )
}
