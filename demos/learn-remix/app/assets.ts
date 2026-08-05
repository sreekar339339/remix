import * as path from 'node:path'
import { createAssetServer } from 'remix/assets'

const isDevelopment = process.env.NODE_ENV === 'development'

// The asset server roots at the monorepo root so workspace package sources
// (remix -> packages/remix, @remix-run/ui -> packages/ui) resolve inside the
// served URL space. App modules are served under /app/*, repo packages under
// /packages/*, and npm dependencies (e.g. immer, installed in the workspace
// root's store) under /node_modules/*.
export const assetServer = createAssetServer({
  basePath: '/assets',
  rootDir: path.resolve(import.meta.dirname, '../../..'),
  allowFiles: ['demos/learn-remix/app/assets/**', 'demos/learn-remix/app/routes.ts'],
  allowPackages: ['remix', 'immer', 'ts-pattern'],
  fileMap: {
    '/app/*path': 'demos/learn-remix/app/*path',
    '/packages/*path': 'packages/*path',
    '/node_modules/*path': 'node_modules/*path',
  },
  sourceMaps: isDevelopment ? 'external' : undefined,
  scripts: {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
  },
})
