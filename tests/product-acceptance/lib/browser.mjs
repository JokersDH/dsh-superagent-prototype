import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  notebook: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
})

/** The product owns its Playwright dependency; acceptance loads that exact install, not its own. */
export function loadPlaywright(root) {
  const require = createRequire(join(root, 'apps/console/package.json'))
  const { chromium } = require('@playwright/test')
  return chromium
}

export async function openBrowser({ root, viewport = VIEWPORTS.desktop, locale = 'zh-CN' } = {}) {
  const chromium = loadPlaywright(root)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport,
    locale,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  return {
    browser,
    context,
    page,
    problems,
    async resize(size) {
      await page.setViewportSize(size)
    },
    async close() {
      await browser.close()
    },
  }
}

export async function gotoConsole(page, url, { waitFor = '.workspace-rail', timeoutMs = 20_000 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  await page.locator(waitFor).waitFor({ timeout: timeoutMs })
}

/**
 * Geometry facts, not aesthetics: horizontal overflow of the document and any element that extends
 * past the viewport, plus boxes for the primary regions so overlap can be checked between them.
 */
export async function layoutFacts(page) {
  return page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const boxes = {}
    for (const [name, selector] of Object.entries({
      topbar: '.topbar',
      rail: '.workspace-rail',
      sidebar: '.sidebar',
      conversation: '.conversation',
      composer: '.composer',
      detail: '.detail',
    })) {
      const element = document.querySelector(selector)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const shown = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      boxes[name] = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: shown,
        onScreen: shown && rect.left < viewport.width - 2 && rect.right > 2,
      }
    }
    const overflowing = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && (rect.right > viewport.width + 2 || rect.left < -2)
      })
      .slice(0, 20)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className.slice(0, 80) : '',
        right: Math.round(element.getBoundingClientRect().right),
      }))
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > viewport.width + 1,
      overflowing,
      boxes,
    }
  })
}

export function intersect(a, b) {
  if (!a || !b || !a.onScreen || !b.onScreen) return 0
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 2 && height > 2 ? width * height : 0
}

export async function screenshot(page, directory, name) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${name}.png`)
  await page.screenshot({ path, fullPage: false })
  return path
}

/** Reads a downloaded file's bytes through Playwright rather than trusting the download event. */
export async function downloadBytes(page, locator, directory, name) {
  mkdirSync(directory, { recursive: true })
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), locator.click()])
  const path = await download.path()
  const { readFileSync } = await import('node:fs')
  const bytes = readFileSync(path)
  const saved = join(directory, name)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(saved, bytes)
  return { bytes, saved, suggestedFilename: download.suggestedFilename() }
}
