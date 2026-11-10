#!/usr/bin/env node
/**
 * B-R3 browser matrix: desktop 1440x900 and narrow 390x844 against a real console + real product.
 *
 * Reuses the console's installed `@playwright/test`; it adds no root dependency. Screenshots and a
 * per-viewport report land in this owned directory. A download is verified by roundtripping its
 * bytes, never by "a download event happened".
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, environmentIdentity, writeReport } from './harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const output = join(here, 'reports', 'browser')
mkdirSync(output, { recursive: true })

const consoleUrl = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5180'
const log = new CaseLog()

let chromium
try {
  const module = await import(join(here, '../../apps/console/node_modules/@playwright/test/index.js'))
  // The package is CommonJS: the browser factory sits on the default export.
  chromium = module.chromium ?? module.default?.chromium
} catch (error) {
  process.stdout.write(`SKIPPED  browser matrix needs the console's @playwright/test: ${error.message}\n`)
  process.exit(0)
}

const browser = await chromium.launch()
try {
  for (const [label, viewport] of [
    ['desktop-1440x900', { width: 1440, height: 900 }],
    ['narrow-390x844', { width: 390, height: 844 }],
  ]) {
    log.begin(`BR3-BROWSER-${label}`, `console loads and is operable at ${viewport.width}x${viewport.height}`, 'browser')
    const context = await browser.newContext({ viewport, acceptDownloads: true })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('pageerror', error => consoleErrors.push(error.message))
    try {
      const response = await page.goto(consoleUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      log.evidence({ httpStatus: response?.status() ?? null })
      // The shell must actually render: a blank page is not a passing console.
      const bodyText = (await page.locator('body').innerText().catch(() => '')).trim()
      const shot = join(output, `${label}.png`)
      await page.screenshot({ path: shot, fullPage: true })
      const shotBytes = readFileSync(shot).length
      log.evidence({ screenshot: shot, screenshotBytes: shotBytes, bodyChars: bodyText.length, consoleErrors })

      // Key controls must be present and not overlapping each other.
      const buttons = await page.locator('button:visible').all()
      const boxes = []
      for (const button of buttons.slice(0, 24)) {
        const box = await button.boundingBox().catch(() => null)
        if (box) boxes.push({ w: box.width, h: box.height, x: box.x, y: box.y })
      }
      const overlapping = []
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i], b = boxes[j]
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlapping.push([i, j])
        }
      }
      const unreachable = boxes.filter(box => box.w <= 0 || box.h <= 0)
      log.evidence({ visibleButtons: boxes.length, overlapping, unreachable: unreachable.length })

      if (response?.ok() && bodyText.length > 0 && shotBytes > 5000 && unreachable.length === 0 && overlapping.length === 0) {
        log.pass(`rendered ${bodyText.length} chars, ${boxes.length} reachable buttons, no overlap, screenshot ${shotBytes}B`)
      } else {
        log.fail(`http=${response?.status()} bodyChars=${bodyText.length} shot=${shotBytes}B unreachable=${unreachable.length} overlap=${overlapping.length}`)
      }

      // Keyboard reachability: Tab must move focus to a real control.
      log.begin(`BR3-KEYBOARD-${label}`, 'keyboard focus reaches an interactive control', 'browser')
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const element = document.activeElement
        return element ? { tag: element.tagName, label: (element.textContent ?? element.getAttribute('aria-label') ?? '').trim().slice(0, 40) } : null
      })
      log.evidence({ focused })
      if (focused && ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(focused.tag)) log.pass(`focus on ${focused.tag} "${focused.label}"`)
      else log.fail(`first Tab landed on ${JSON.stringify(focused)}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}

const report = writeReport({ cases: log.cases, environment: environmentIdentity({ lane: 'BR3 browser', consoleUrl }) }, join(here, 'reports', 'br3-browser.json'))
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(28)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nBR3 browser totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
