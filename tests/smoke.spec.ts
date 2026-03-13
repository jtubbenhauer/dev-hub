import { test, expect } from '@playwright/test'

test('dashboard loads', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('body')).not.toBeEmpty()
})
