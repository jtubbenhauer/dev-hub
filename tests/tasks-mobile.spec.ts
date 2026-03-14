import { test, expect, type Page, type Route } from '@playwright/test'

// -- Fixture data ----------------------------------------------------------

const SETTINGS_RESPONSE: Record<string, unknown> = {
  'clickup-api-token': 'pk_fake_token_12345',
  'clickup-team-id': 'team_001',
  'clickup-pinned-views': [
    { id: 'view_pinned_1', name: 'Sprint Board' },
  ],
}

const HIERARCHY_RESPONSE = {
  spaces: [
    {
      id: 'space_1',
      name: 'Engineering',
      color: '#7B68EE',
      folders: [
        {
          id: 'folder_1',
          name: 'Backend',
          lists: [
            { id: 'list_1', name: 'API Tasks', task_count: 12 },
          ],
        },
      ],
      lists: [
        { id: 'list_2', name: 'Infra', task_count: 5 },
      ],
    },
  ],
  views: [
    { id: 'view_1', name: 'All Tasks', type: 'list', parent: { id: 'space_1', type: 6 } },
  ],
}

function makeTask(id: string, name: string, status = 'open'): Record<string, unknown> {
  return {
    id,
    custom_id: null,
    name,
    status: { status, color: '#87ceeb', type: 'open' },
    priority: { id: '3', priority: 'normal', color: '#6fddff' },
    assignees: [{ id: 1, username: 'jack', email: 'jack@test.com', color: '#ff0000', profilePicture: null, initials: 'JK' }],
    due_date: null,
    date_created: String(Date.now()),
    date_updated: String(Date.now()),
    date_closed: null,
    url: `https://app.clickup.com/t/${id}`,
    list: { id: 'list_1', name: 'API Tasks' },
    folder: { id: 'folder_1', name: 'Backend' },
    space: { id: 'space_1' },
    tags: [],
  }
}

const TASKS = [
  makeTask('task_001', 'Fix login redirect bug'),
  makeTask('task_002', 'Add rate limiting middleware'),
  makeTask('task_003', 'Update user profile API'),
]

const TASK_DETAIL = {
  ...TASKS[0],
  markdown_description: 'Fix the redirect loop on the login page.',
  text_content: 'Fix the redirect loop on the login page.',
  custom_fields: [],
  time_estimate: null,
  time_spent: null,
  parent: null,
}

const COMMENTS_RESPONSE = {
  comments: [
    {
      id: 'comment_1',
      comment_text: 'This needs to be fixed before release.',
      user: { id: 1, username: 'jack', email: 'jack@test.com', color: '#ff0000', profilePicture: null, initials: 'JK' },
      date: String(Date.now()),
      resolved: false,
    },
  ],
}

// -- Route mocking helpers -------------------------------------------------

async function mockClickUpRoutes(page: Page) {
  // Catch-all registered first = lowest priority in Playwright
  await page.route('**/api/clickup/**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })

  await page.route('**/api/settings', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETTINGS_RESPONSE) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
  })

  await page.route('**/api/clickup/hierarchy', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HIERARCHY_RESPONSE) })
  })

  await page.route('**/api/clickup/search*', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: TASKS }) })
  })

  await page.route('**/api/clickup/views/*/tasks*', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: TASKS }) })
  })

  await page.route('**/api/clickup/tasks/*/comments', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMMENTS_RESPONSE) })
  })

  await page.route('**/api/clickup/tasks/*', async (route: Route) => {
    const url = route.request().url()
    if (url.includes('/comments')) {
      await route.continue()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task: TASK_DETAIL }) })
  })

  await page.route('**/api/clickup/my-tasks', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: TASKS }) })
  })

  await page.route('**/api/clickup/user', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1, username: 'jack', email: 'jack@test.com', color: '#ff0000', profilePicture: null, initials: 'JK' } }) })
  })

  await page.route('**/api/clickup/team', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ teams: [{ id: 'team_001', name: 'Test Team', color: '#000000', avatar: null }] }) })
  })
}

async function clearTasksStorage(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('dev-hub:tasks-selection')
    localStorage.removeItem('dev-hub:tasks-search')
    localStorage.removeItem('dev-hub:tasks-selected-task-id')
    localStorage.removeItem('dev-hub:tasks-expanded-spaces')
    localStorage.removeItem('dev-hub:tasks-expanded-folders')
  })
}

// -- Locator helpers -------------------------------------------------------

// The Sheet dialog content that holds the sidebar (portaled by Radix)
function sheetSidebar(page: Page) {
  return page.locator('[data-slot="sheet-content"]').filter({ has: page.getByPlaceholder('Search tasks...') })
}

// The tasks sidebar <aside> (used for desktop inline layout)
function tasksSidebar(page: Page) {
  return page.locator('aside').filter({ has: page.getByPlaceholder('Search tasks...') })
}

// The sidebar toggle button in the mobile toolbar
function sidebarToggle(page: Page) {
  return page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
}

// The detail Sheet dialog (portaled by Radix, identified by accessible name)
function detailSheet(page: Page) {
  return page.getByRole('dialog', { name: 'Task detail' })
}

async function openSidebar(page: Page) {
  await sidebarToggle(page).click({ force: true })
  await expect(sheetSidebar(page)).toBeVisible({ timeout: 3000 })
}

// -- Tests -----------------------------------------------------------------

const MOBILE_VIEWPORT = { width: 375, height: 812 }

test.describe('Tasks page — mobile responsive', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await mockClickUpRoutes(page)
    await page.goto('/tasks')
    await clearTasksStorage(page)
    await page.reload({ waitUntil: 'networkidle' })
  })

  test('sidebar is NOT visible by default on mobile', async ({ page }) => {
    await expect(sheetSidebar(page)).not.toBeVisible()
  })

  test('sidebar toggle button is visible on mobile', async ({ page }) => {
    await expect(sidebarToggle(page)).toBeVisible()
  })

  test('tapping sidebar button opens sidebar Sheet', async ({ page }) => {
    await openSidebar(page)

    const sheet = sheetSidebar(page)
    await expect(sheet.getByText('Browse', { exact: true })).toBeVisible()
    await expect(sheet.getByPlaceholder('Search tasks...')).toBeVisible()
  })

  test('sidebar shows hierarchy after opening', async ({ page }) => {
    await openSidebar(page)

    const sheet = sheetSidebar(page)
    await expect(sheet.getByText('Pinned Views')).toBeVisible()
    await expect(sheet.getByText('Sprint Board')).toBeVisible()
    await expect(sheet.getByText('Engineering')).toBeVisible()
  })

  test('selecting a pinned view closes sidebar and loads tasks', async ({ page }) => {
    await openSidebar(page)

    const sheet = sheetSidebar(page)
    await sheet.getByText('Sprint Board').click({ force: true })

    await expect(sheet).not.toBeVisible()
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })
  })

  test('selecting a list closes sidebar and loads tasks', async ({ page }) => {
    await openSidebar(page)

    const sheet = sheetSidebar(page)
    await sheet.getByText('Engineering').click({ force: true })
    await sheet.getByText('Backend').click({ force: true })
    await sheet.getByText('API Tasks').click({ force: true })

    await expect(sheet).not.toBeVisible()
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })
  })

  test('tapping a task opens the detail Sheet from the right', async ({ page }) => {
    await openSidebar(page)
    await sheetSidebar(page).getByText('Sprint Board').click({ force: true })
    await expect(sheetSidebar(page)).not.toBeVisible()

    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })
    await page.getByText('Fix login redirect bug').click({ force: true })

    const detail = detailSheet(page)
    await expect(detail).toBeVisible({ timeout: 5000 })
    await expect(detail.locator('h2', { hasText: 'Fix login redirect bug' })).toBeVisible({ timeout: 5000 })
    await expect(detail.getByText('Open in ClickUp')).toBeVisible()
  })

  test('closing the detail Sheet dismisses it', async ({ page }) => {
    await openSidebar(page)
    await sheetSidebar(page).getByText('Sprint Board').click({ force: true })
    await expect(sheetSidebar(page)).not.toBeVisible()
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })

    await page.getByText('Fix login redirect bug').click({ force: true })

    const detail = detailSheet(page)
    await expect(detail).toBeVisible({ timeout: 5000 })
    await expect(detail.locator('h2', { hasText: 'Fix login redirect bug' })).toBeVisible({ timeout: 5000 })

    // Close via the X button inside the task detail panel
    const closeButton = detail.locator('button').filter({ has: page.locator('svg.lucide-x') })
    await closeButton.click({ force: true })

    await expect(detail).not.toBeVisible()
  })

  test('empty state shows mobile-specific message', async ({ page }) => {
    await expect(page.getByText('Tap the sidebar button to browse views and lists, or search for tasks.')).toBeVisible()
  })

  test('search from sidebar auto-closes and loads results', async ({ page }) => {
    await openSidebar(page)

    const searchInput = sheetSidebar(page).getByPlaceholder('Search tasks...')
    await searchInput.pressSequentially('Fix login', { delay: 50 })

    await expect(sheetSidebar(page)).not.toBeVisible()
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Search results')).toBeVisible()
  })
})

test.describe('Tasks page — desktop layout preserved', () => {
  test('sidebar is visible inline on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await mockClickUpRoutes(page)
    await page.goto('/tasks')
    await clearTasksStorage(page)
    await page.reload({ waitUntil: 'networkidle' })

    await expect(tasksSidebar(page)).toBeVisible()
    await expect(sidebarToggle(page)).not.toBeVisible()
  })
})
