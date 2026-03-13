import { test as setup, expect } from '@playwright/test'
import path from 'path'

const authFile = path.join(__dirname, '.auth/user.json')
const USERNAME = 'testuser'
const PASSWORD = 'testpassword123'

setup('authenticate', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Create Account' }).click()
    await page.waitForURL('/', { timeout: 15000 })
  } else {
    await page.fill('#username', USERNAME)
    await page.fill('#password', PASSWORD)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.waitForURL('/', { timeout: 15000 })
  }

  await page.context().storageState({ path: authFile })
})
