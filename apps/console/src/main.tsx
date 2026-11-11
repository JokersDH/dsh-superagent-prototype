import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { FixtureAdapter } from './fixture.ts'
import { HttpTransport } from './transport.ts'
import './styles.css'
import './workbench.css'
import './attention.css'
import './decisions.css'
import './proposals.css'

const fixtureMode = import.meta.env.VITE_CONSOLE_MODE !== 'http'
const transport = fixtureMode ? new FixtureAdapter(window.sessionStorage) : new HttpTransport()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App transport={transport} />
  </React.StrictMode>,
)

if (fixtureMode) {
  document.documentElement.dataset.consoleMode = 'fixture'
} else {
  document.documentElement.dataset.consoleMode = 'http'
}
