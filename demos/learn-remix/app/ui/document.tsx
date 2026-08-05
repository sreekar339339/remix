import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../routes.ts'

export interface DocumentProps {
  children?: RemixNode
  head?: RemixNode
  title?: string
}

const DEFAULT_TITLE = readAppDisplayName('Learn Remix')

const FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, title = DEFAULT_TITLE } = handle.props
    let glimmer = `
    @keyframes glimmer {
      from {
        background-position: 160% 0;
      }
      to {
        background-position: -60% 0;
      }
    }
    @keyframes todoActionSpin {
      to {
        transform: rotate(360deg);
      }
    }
    `
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <title>{title}</title>
          <meta name="color-scheme" content="light dark" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
          />
          <style>{glimmer}</style>
        </head>
        <body
          mix={css({
            // Light-mode design tokens (default).
            '--surface-0': '#dee2e6',
            '--surface-3': '#f0f4f7',
            '--surface-4': '#f7fbff',
            '--text-primary': '#313539',
            '--text-tertiary': '#94989c',
            '--brand-blue': '#2dacf9',
            // Dark-mode overrides.
            '@media (prefers-color-scheme: dark)': {
              '--surface-0': '#1e2226',
              '--surface-3': '#313539',
              '--surface-4': '#363a3e',
              '--text-primary': '#dee2e6',
              '--text-tertiary': '#94989c',
            },
            '& *, & *::before, & *::after': { boxSizing: 'border-box' },
            margin: 0,
            background: 'var(--surface-0)',
            color: 'var(--text-primary)',
            fontFamily: FONT_STACK,
            fontSize: '14px',
            lineHeight: 1.5,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          })}
        >
          {children}
          <script type="module" src={routes.assets.href({ path: 'app/assets/entry.ts' })}></script>
        </body>
      </html>
    )
  }
}

function readAppDisplayName(value: string): string {
  return value.startsWith('%%') ? 'Remix App' : decodeURIComponent(value)
}
