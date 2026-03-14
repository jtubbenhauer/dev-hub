import { test as setup, expect } from '@playwright/test'
import path from 'path'
import crypto from 'node:crypto'

const authFile = path.join(__dirname, '.auth/user.json')
const USERNAME = 'testuser'
const PASSWORD = 'testpassword123'

// Ensure testuser exists in the DB before attempting sign-in.
// The setup API refuses to create users when any user already exists,
// so we insert directly via better-sqlite3 when needed.
async function ensureTestUser() {
  const Database = (await import('better-sqlite3')).default
  const { hash } = await import('bcryptjs')

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'dev-hub.db')
  const db = new Database(dbPath)

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME)
  if (!existing) {
    const passwordHash = await hash(PASSWORD, 12)
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, unixepoch())').run(
      crypto.randomUUID(),
      USERNAME,
      passwordHash,
    )
  }

  db.close()
}

setup('authenticate', async ({ page }) => {
  await ensureTestUser()

  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  const needsSetup = await page.evaluate(async () => {
    const res = await fetch('/api/auth/setup')
    const data = await res.json()
    return data.needsSetup
  })

  if (needsSetup) {
    await page.fill('#setup-username', USERNAME)
    await page.fill('#setup-password', PASSWORD)
    await page.fill('#setup-confirm-password', PASSWORD)
    await page.getByRole('button', { name: 'Create Account' }).click({ force: true })
    await page.waitForURL('/', { timeout: 15000 })
  } else {
    await page.fill('#username', USERNAME)
    await page.fill('#password', PASSWORD)
    await page.getByRole('button', { name: 'Sign In' }).click({ force: true })
    await page.waitForURL('/', { timeout: 15000 })
  }

  await page.context().storageState({ path: authFile })
})
