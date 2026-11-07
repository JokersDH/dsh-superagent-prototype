/**
 * Child process for the crash probe. It performs exactly one write pattern and then SIGKILLs itself,
 * so the parent can observe what SQLite recovers from: a committed autocommit write must survive,
 * an open transaction must not.
 */
import Database from 'better-sqlite3'

const [dbPath, mode] = process.argv.slice(2)
if (!dbPath || !mode) {
  process.stderr.write('usage: crash-child.mjs <db-path> <commit-then-die|begin-then-die>\n')
  process.exit(2)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = FULL')
db.pragma('busy_timeout = 5000')
db.exec('CREATE TABLE IF NOT EXISTS durable (id TEXT PRIMARY KEY, note TEXT NOT NULL)')
const insert = db.prepare('INSERT INTO durable (id, note) VALUES (?, ?)')

if (mode === 'commit-then-die') {
  insert.run('committed-before-crash', 'committed')
  process.kill(process.pid, 'SIGKILL')
} else if (mode === 'begin-then-die') {
  db.exec('BEGIN IMMEDIATE')
  insert.run('uncommitted-at-crash', 'uncommitted')
  process.kill(process.pid, 'SIGKILL')
} else {
  process.stderr.write(`unknown mode: ${mode}\n`)
  process.exit(2)
}
