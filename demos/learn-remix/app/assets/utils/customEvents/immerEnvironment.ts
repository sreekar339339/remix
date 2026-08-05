// Remix's browser-test module server does not apply the app asset defines.
let isBrowserTestModule = new URL(import.meta.url).pathname.startsWith('/scripts/')
if (isBrowserTestModule && typeof process === 'undefined') {
  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: { env: { NODE_ENV: 'production' } },
  })
}
