import { serve } from '@hono/node-server'
import { createServer, type Server } from 'node:http'
import type { createLocalHttpApp } from './app.ts'

export function listenLocalHttp(app: ReturnType<typeof createLocalHttpApp>, port: number) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid loopback HTTP port')
  const server = serve({ fetch: app.fetch, createServer, hostname: '127.0.0.1', port }) as Server
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5000
  return server
}
