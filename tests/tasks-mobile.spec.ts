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
  // Settings — must return clickup-api-token and clickup-team-id
  await page.route('**/api/settings', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETTINGS_RESPONSE) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
  })

  // Hierarchy
  await page.route('**/api/clickup/hierarchy', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HIERARCHY_RESPONSE) })
  })

  // Search (covers list browsing and text search)
  await page.route('**/api/clickup/search*', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: TASKS }) })
  })

  // View tasks
  await page.route('**/api/clickup/views/*/tasks*', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: TASKS }) })
  })

  // Task detail (specific task routes registered after generic catch-all)
  await page.route('**/api/clickup/tasks/*/comments', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMMENTS_RESPONSE) })
  })

  await page.route('**/api/clickup/tasks/*', async (route: Route) => {
    const url = route.request().url()
    // Skip if this is a /comments sub-route (already handled above)
    if (url.includes('/comments')) {
      await route.continue()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task: TASK_DETAIL }) })
  })

  // My tasks
  await page.route('**/api/clickup/my-tasks', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: TASKS }) })
  })

  // User
  await page.route('**/api/clickup/user', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1, username: 'jack', email: 'jack@test.com', color: '#ff0000', profilePicture: null, initials: 'JK' } }) })
  })

  // Team
  await page.route('**/api/clickup/team', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ teams: [{ id: 'team_001', name: 'Test Team', color: '#000000', avatar: null }] }) })
  })

  // Catch-all for any other clickup API routes
  await page.route('**/api/clickup/**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })
}

// Clear tasks-related localStorage to prevent stale state leaking between tests
async function clearTasksStorage(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('dev-hub:tasks-selection')
    localStorage.removeItem('dev-hub:tasks-search')
    localStorage.removeItem('dev-hub:tasks-selected-task-id')
    localStorage.removeItem('dev-hub:tasks-expanded-spaces')
    localStorage.removeItem('dev-hub:tasks-expanded-folders')
  })
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
    // The sidebar <aside> should not be visible in the main viewport
    const sidebar = page.locator('aside')
    await expect(sidebar).not.toBeVisible()
  })

  test('sidebar toggle button is visible on mobile', async ({ page }) => {
    // The PanelLeft button should be visible in the mobile toolbar
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await expect(toggleButton).toBeVisible()
  })

  test('tapping sidebar button opens sidebar Sheet', async ({ page }) => {
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await toggleButton.click()

    // The Sheet should render the sidebar with "Browse" section
    const browseHeading = page.getByText('Browse', { exact: true })
    await expect(browseHeading).toBeVisible()

    // The search input should be visible inside the Sheet
    const searchInput = page.getByPlaceholder('Search tasks...')
    await expect(searchInput).toBeVisible()
  })

  test('sidebar shows hierarchy after opening', async ({ page }) => {
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await toggleButton.click()

    // Pinned Views section should show
    await expect(page.getByText('Pinned Views')).toBeVisible()
    await expect(page.getByText('Sprint Board')).toBeVisible()

    // Space should be listed under Browse
    await expect(page.getByText('Engineering')).toBeVisible()
  })

  test('selecting a pinned view closes sidebar and loads tasks', async ({ page }) => {
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await toggleButton.click()

    // Click the pinned view
    await page.getByText('Sprint Board').click()

    // Sidebar should close (the aside inside the Sheet should no longer be visible)
    await expect(page.locator('aside')).not.toBeVisible({ timeout: 3000 })

    // Tasks should be loaded — look for the first task name
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })

    // Context label should show the view name in the mobile toolbar
    await expect(page.getByText('Sprint Board')).toBeVisible()
  })

  test('selecting a list closes sidebar and loads tasks', async ({ page }) => {
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await toggleButton.click()

    // Expand the space to see folders and lists
    await page.getByText('Engineering').click()
    await page.getByText('Backend').click()

    // Click a list
    await page.getByText('API Tasks').click()

    // Sidebar should close
    await expect(page.locator('aside')).not.toBeVisible({ timeout: 3000 })

    // Tasks should appear
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })
  })

  test('tapping a task opens the detail Sheet from the right', async ({ page }) => {
    // First select a view to load tasks
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await toggleButton.click()
    await page.getByText('Sprint Board').click()

    // Wait for tasks
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })

    // Tap the first task
    await page.getByText('Fix login redirect bug').click()

    // The detail panel should open with the task name as heading
    const detailHeading = page.locator('h2', { hasText: 'Fix login redirect bug' })
    await expect(detailHeading).toBeVisible({ timeout: 5000 })

    // Should show the "Open in ClickUp" link
    await expect(page.getByText('Open in ClickUp')).toBeVisible()
  })

  test('closing the detail Sheet dismisses it', async ({ page }) => {
    // Load tasks via pinned view
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await toggleButton.click()
    await page.getByText('Sprint Board').click()
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })

    // Open detail
    await page.getByText('Fix login redirect bug').click()
    const detailHeading = page.locator('h2', { hasText: 'Fix login redirect bug' })
    await expect(detailHeading).toBeVisible({ timeout: 5000 })

    // Close via the X button in the detail panel
    const closeButton = page.locator('[data-radix-dialog-content]').last().locator('button').filter({ has: page.locator('svg.lucide-x') })
    await closeButton.click()

    // The detail heading should no longer be visible
    await expect(detailHeading).not.toBeVisible({ timeout: 3000 })
  })

  test('empty state shows mobile-specific message', async ({ page }) => {
    // With no selection, the empty state should show mobile-specific text
    await expect(page.getByText('Tap the sidebar button to browse views and lists, or search for tasks.')).toBeVisible()
  })

  test('search from sidebar auto-closes and loads results', async ({ page }) => {
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await toggleButton.click()

    // Type in the search input
    const searchInput = page.getByPlaceholder('Search tasks...')
    await searchInput.fill('Fix login')

    // Sidebar should auto-close after typing 2+ chars
    await expect(page.locator('aside')).not.toBeVisible({ timeout: 3000 })

    // Search results should show
    await expect(page.getByText('Fix login redirect bug')).toBeVisible({ timeout: 5000 })

    // Context label should show "Search results"
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

    // The sidebar <aside> should be directly visible (not inside a Sheet)
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible()

    // The mobile toggle button should NOT be visible
    const toggleButton = page.locator('button').filter({ has: page.locator('svg.lucide-panel-left') })
    await expect(toggleButton).not.toBeVisible()
  })
})
