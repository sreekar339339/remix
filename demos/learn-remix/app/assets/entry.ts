import { run } from 'remix/ui'

run({
  async loadModule(moduleUrl, exportName) {
    let mod = await import(moduleUrl)
    return mod[exportName]
  },
  async resolveFrame(src, options) {
    let headers = new Headers({ Accept: 'text/html' })
    if (options?.target) headers.set('X-Remix-Target', options.target)
    let response = await fetch(src, { headers, signal: options?.signal })
    if (!response.ok) {
      return `<pre>Frame error: ${response.status} ${response.statusText}</pre>`
    }
    return response.body ?? (await response.text())
  },
})
