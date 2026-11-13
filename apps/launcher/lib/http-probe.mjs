/**
 * Minimal loopback GET with `agent:false` and `connection: close`. Using node:http instead of the
 * global fetch keeps no keep-alive pool alive inside the launcher, so a graceful stop can exit
 * immediately instead of waiting for an idle socket timeout.
 */
import { request } from 'node:http'

export function httpGet(url, { timeoutMs = 2000, parseJson = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const outgoing = request(url, { method: 'GET', agent: false, headers: { connection: 'close' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (parseJson) {
          try {
            resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body: JSON.parse(body) })
          } catch {
            reject(new Error(`Invalid JSON from ${url}`))
          }
        } else resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body })
      })
      response.on('error', reject)
    })
    outgoing.setTimeout(timeoutMs, () => outgoing.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`)))
    outgoing.on('error', reject)
    outgoing.end()
  })
}
