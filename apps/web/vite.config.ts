import { readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import yaml from '@rollup/plugin-yaml'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const tmpRoot = resolve(repoRoot, 'tmp')
const gerberRoot = resolve(tmpRoot, 'gerber_extracted')
const parsersSource = resolve(repoRoot, 'packages/parsers/src/index.ts')
const viewerSource = resolve(repoRoot, 'packages/viewer/src/index.ts')
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as { version?: string }
const appVersion = normalizeReleaseVersion(
  process.env.VITE_BOMBOARD_VERSION
    ?? process.env.BOMBOARD_VERSION
    ?? process.env.GITHUB_REF_NAME
    ?? rootPackage.version
    ?? '0.1.0'
)

function footprintLibraryCachePlugin(): Plugin {
  return {
    name: 'bomboard-footprint-library-cache',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')
        if (requestUrl.pathname.startsWith('/footprints/')) {
          response.setHeader('Cache-Control', 'no-store')
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')
        if (requestUrl.pathname.startsWith('/footprints/')) {
          response.setHeader('Cache-Control', 'no-store')
        }
        next()
      })
    },
  }
}

function sampleDataPlugin(): Plugin {
  return {
    name: 'bomboard-sample-data',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')

        if (requestUrl.pathname === '/sample-data/manifest.json') {
          try {
            const gerberFiles = (await readdir(gerberRoot)).sort()
            sendJson(response, {
              bomFile: 'BOM.csv',
              coordinateFile: 'PickPlaces.csv',
              gerberFiles,
            })
          } catch (error) {
            sendError(response, error)
          }
          return
        }

        if (requestUrl.pathname === '/sample-data/BOM.csv') {
          await sendFile(response, resolve(tmpRoot, 'BOM.csv'))
          return
        }

        if (requestUrl.pathname === '/sample-data/PickPlaces.csv') {
          await sendFile(response, resolve(tmpRoot, 'PickPlaces.csv'))
          return
        }

        if (requestUrl.pathname.startsWith('/sample-data/gerber/')) {
          const name = decodeURIComponent(requestUrl.pathname.slice('/sample-data/gerber/'.length))
          const target = resolve(gerberRoot, name)
          if (!target.startsWith(`${gerberRoot}/`)) {
            response.statusCode = 400
            response.end('Invalid sample path')
            return
          }

          await sendFile(response, target)
          return
        }

        next()
      })
    },
  }
}

async function sendFile(response: ServerResponse, path: string) {
  try {
    const bytes = await readFile(path)
    response.setHeader('Content-Type', contentType(path))
    response.end(bytes)
  } catch (error) {
    sendError(response, error)
  }
}

function sendJson(response: ServerResponse, value: unknown) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function sendError(response: ServerResponse, error: unknown) {
  response.statusCode = 500
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end(error instanceof Error ? error.message : String(error))
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.csv':
      return 'text/csv'
    case '.json':
      return 'application/json'
    default:
      return 'text/plain'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), yaml(), footprintLibraryCachePlugin(), sampleDataPlugin()],
  define: {
    __BOMBOARD_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@bomboard/parsers': parsersSource,
      '@bomboard/viewer': viewerSource,
    },
  },
  optimizeDeps: {
    exclude: ['@bomboard/parsers', '@bomboard/viewer'],
  },
})

function normalizeReleaseVersion(value: string): string {
  const cleaned = value.trim().replace(/^refs\/tags\//, '').replace(/^v/i, '')
  return cleaned || '0.1.0'
}
