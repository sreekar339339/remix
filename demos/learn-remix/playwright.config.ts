import { defineConfig } from 'playwright/test'

// Chromium-only: several demo tests assert Chromium focus behavior (e.g.
// `focusout` firing when a focused element becomes disabled), which Firefox
// does not implement. Re-enable a firefox project only after those tests are
// made cross-browser.
export default defineConfig({
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
