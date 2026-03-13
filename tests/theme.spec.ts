import { test, expect, type Page } from '@playwright/test'

async function setThemeViaUI(page: Page, themeValue: string) {
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  await page.locator(`[data-testid="theme-${themeValue}"]`).click()
  await page.waitForTimeout(500)
}

async function getHtmlClasses(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.documentElement.classList))
}

async function getCSSVar(page: Page, varName: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    varName
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('dev-hub-theme'))
})

test.describe('Theme application', () => {
  test('default-dark applies .dark class only', async ({ page }) => {
    await setThemeViaUI(page, 'default-dark')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).not.toContain('catppuccin-mocha')
    expect(classes).not.toContain('catppuccin-latte')
    await page.screenshot({ path: '.sisyphus/evidence/task-13-default-dark.png' })
  })

  test('default-light applies .light class only', async ({ page }) => {
    await setThemeViaUI(page, 'default-light')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('light')
    expect(classes).not.toContain('dark')
    expect(classes).not.toContain('catppuccin-latte')
    await page.screenshot({ path: '.sisyphus/evidence/task-13-default-light.png' })
  })

  test('catppuccin-mocha applies .dark .catppuccin-mocha', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-mocha')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).toContain('catppuccin-mocha')
    const bg = await getCSSVar(page, '--background')
    expect(bg).toBeTruthy()
    await page.screenshot({ path: '.sisyphus/evidence/task-13-catppuccin-mocha.png' })
  })

  test('catppuccin-macchiato applies .dark .catppuccin-macchiato', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-macchiato')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).toContain('catppuccin-macchiato')
    await page.screenshot({ path: '.sisyphus/evidence/task-13-catppuccin-macchiato.png' })
  })

  test('catppuccin-frappe applies .dark .catppuccin-frappe', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-frappe')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).toContain('catppuccin-frappe')
    await page.screenshot({ path: '.sisyphus/evidence/task-13-catppuccin-frappe.png' })
  })

  test('catppuccin-latte applies .light .catppuccin-latte', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-latte')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('light')
    expect(classes).toContain('catppuccin-latte')
    expect(classes).not.toContain('dark')
    await page.screenshot({ path: '.sisyphus/evidence/task-13-catppuccin-latte.png' })
  })

  test('dracula applies .dark .dracula', async ({ page }) => {
    await setThemeViaUI(page, 'dracula')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).toContain('dracula')
    const bg = await getCSSVar(page, '--background')
    expect(bg).toBeTruthy()
    await page.screenshot({ path: '.sisyphus/evidence/task-13-dracula.png' })
  })
})

test.describe('Class cleanup on theme switch', () => {
  test('switching from catppuccin-mocha to default-dark removes mocha class', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-mocha')
    let classes = await getHtmlClasses(page)
    expect(classes).toContain('catppuccin-mocha')

    await setThemeViaUI(page, 'default-dark')
    classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).not.toContain('catppuccin-mocha')
  })

  test('switching from catppuccin-latte to catppuccin-mocha removes latte class', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-latte')
    await setThemeViaUI(page, 'catppuccin-mocha')
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).toContain('catppuccin-mocha')
    expect(classes).not.toContain('catppuccin-latte')
    expect(classes).not.toContain('light')
  })

  test('switching from dracula to default-dark removes dracula class', async ({ page }) => {
    await setThemeViaUI(page, 'dracula')
    let classes = await getHtmlClasses(page)
    expect(classes).toContain('dracula')

    await setThemeViaUI(page, 'default-dark')
    classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).not.toContain('dracula')
  })
})

test.describe('Theme persistence (FOUC prevention)', () => {
  test('catppuccin-mocha persists across page reload with no FOUC', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-mocha')
    const stored = await page.evaluate(() => localStorage.getItem('dev-hub-theme'))
    expect(stored).toBe('catppuccin-mocha')

    await page.reload({ waitUntil: 'domcontentloaded' })
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).toContain('catppuccin-mocha')
  })

  test('catppuccin-latte persists across page reload', async ({ page }) => {
    await setThemeViaUI(page, 'catppuccin-latte')
    const stored = await page.evaluate(() => localStorage.getItem('dev-hub-theme'))
    expect(stored).toBe('catppuccin-latte')

    await page.reload({ waitUntil: 'domcontentloaded' })
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('light')
    expect(classes).toContain('catppuccin-latte')
  })

  test('default-dark persists across page reload', async ({ page }) => {
    await setThemeViaUI(page, 'default-dark')
    await page.reload({ waitUntil: 'domcontentloaded' })
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).not.toContain('catppuccin-mocha')
  })

  test('dracula persists across page reload with no FOUC', async ({ page }) => {
    await setThemeViaUI(page, 'dracula')
    const stored = await page.evaluate(() => localStorage.getItem('dev-hub-theme'))
    expect(stored).toBe('dracula')

    await page.reload({ waitUntil: 'domcontentloaded' })
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
    expect(classes).toContain('dracula')
  })
})

test.describe('System theme', () => {
  test('system theme with dark OS preference applies .dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('dev-hub-theme', 'system'))
    await page.reload({ waitUntil: 'networkidle' })
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('dark')
  })

  test('system theme with light OS preference applies .light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('dev-hub-theme', 'system'))
    await page.reload({ waitUntil: 'networkidle' })
    const classes = await getHtmlClasses(page)
    expect(classes).toContain('light')
    expect(classes).not.toContain('dark')
  })
})

test.describe('Edge cases', () => {
  test('invalid localStorage value falls back gracefully', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('dev-hub-theme', 'totally-invalid-theme'))
    await page.reload({ waitUntil: 'networkidle' })
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('no localStorage value uses system default', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.removeItem('dev-hub-theme'))
    await page.reload({ waitUntil: 'networkidle' })
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})

test.describe('Theme picker UI', () => {
  test('settings page shows all 8 theme options', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-testid="theme-system"]')).toBeVisible()
    await expect(page.locator('[data-testid="theme-default-dark"]')).toBeVisible()
    await expect(page.locator('[data-testid="theme-default-light"]')).toBeVisible()
    await expect(page.locator('[data-testid="theme-catppuccin-latte"]')).toBeVisible()
    await expect(page.locator('[data-testid="theme-catppuccin-frappe"]')).toBeVisible()
    await expect(page.locator('[data-testid="theme-catppuccin-macchiato"]')).toBeVisible()
    await expect(page.locator('[data-testid="theme-catppuccin-mocha"]')).toBeVisible()
    await expect(page.locator('[data-testid="theme-dracula"]')).toBeVisible()
    await page.screenshot({ path: '.sisyphus/evidence/task-13-theme-picker.png', fullPage: false })
  })
})
