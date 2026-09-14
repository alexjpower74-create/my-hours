import { test, expect } from '@playwright/test'

const MONDAY = new Date(2026, 8, 14, 12, 0, 0)
const SUNDAY = new Date(2026, 8, 20, 12, 0, 0)

async function openAt(page, date) {
  await page.clock.install({ time: date })
  await page.goto('/')
}

async function completeSetup(page) {
  const start = page.getByLabel('First day of the pay period')
  await start.fill('2026-09-07')
  await start.press('Tab')
  await expect(page.getByLabel('Last day of the pay period')).toHaveValue('2026-09-20')
  await page.getByRole('button', { name: 'Save dates' }).click()
  await expect(page.locator('.day-row')).toHaveCount(14)
  await expect(page.locator('.hours-input')).toHaveCount(42)
}

const categoryTotal = (page, id) => page.locator(`.category-total[data-category="${id}"] .category-total-value`)

test('tracks a fortnight, validates hours, navigates, and survives refresh', async ({ page, browserName }) => {
  await openAt(page, MONDAY)

  await expect(page.getByRole('heading', { name: 'Set your pay period' })).toBeVisible()
  await completeSetup(page)

  const today = page.locator('.day-row[data-key="2026-09-14"]')
  await expect(today).toHaveAttribute('aria-current', 'date')
  await expect(today.getByText('Today')).toBeVisible()

  await expect(today.locator('.category-name')).toHaveText([
    /^Dennis Heavy Duty/, /^Dennis Automotive/, /^Customer/,
  ])
  await expect(page.locator('.category-total-label')).toHaveText(['Dennis Heavy Duty', 'Dennis Automotive', 'Customer'])

  const first = page.locator('#hours-2026-09-07-heavy-duty')
  const second = page.locator('#hours-2026-09-08-heavy-duty')
  await first.click()
  await first.pressSequentially('8')
  await second.click()
  await second.pressSequentially('7.5')
  await expect(page.locator('#total-value')).toHaveText('15.5 hours')

  // Same day, other categories: each total stays separate, the overall total adds them all.
  await page.locator('#hours-2026-09-07-automotive').fill('2.25')
  await page.locator('#hours-2026-09-14-customer').fill('1')
  await expect(categoryTotal(page, 'heavy-duty')).toHaveText('15.5 hours')
  await expect(categoryTotal(page, 'automotive')).toHaveText('2.25 hours')
  await expect(categoryTotal(page, 'customer')).toHaveText('1 hour')
  await expect(page.locator('#total-value')).toHaveText('18.75 hours')
  await expect(page.locator('.category-total[data-category="earlier"]')).toHaveCount(0)

  const note = page.locator('#note-2026-09-14-customer')
  await note.fill('Brakes on the service truck')
  await page.locator('#hours-2026-09-07-automotive').fill('')
  await expect(categoryTotal(page, 'automotive')).toHaveText('0 hours')
  await expect(page.locator('#total-value')).toHaveText('16.5 hours')

  await first.click()
  await first.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await first.pressSequentially('8x')
  await expect(first).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#total-value')).toHaveText('8.5 hours')

  await first.click()
  await first.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await first.pressSequentially('8')
  await expect(page.locator('#total-value')).toHaveText('16.5 hours')
  await page.reload()
  await expect(page.locator('#total-value')).toHaveText('16.5 hours')
  await expect(categoryTotal(page, 'heavy-duty')).toHaveText('15.5 hours')
  await expect(categoryTotal(page, 'customer')).toHaveText('1 hour')
  await expect(first).toHaveValue('8')
  await expect(note).toHaveValue('Brakes on the service truck')
  await expect(page.locator('#note-2026-09-13-customer')).toHaveValue('')

  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(page.locator('#period-kicker')).toHaveText('Upcoming pay period')
  await expect(page.locator('.day-row.is-today')).toHaveCount(0)
  await page.getByRole('button', { name: 'Go to today' }).click()
  await expect(page.locator('.day-row[data-key="2026-09-14"]')).toHaveAttribute('aria-current', 'date')

  await page.getByRole('button', { name: 'Edit dates' }).click()
  await expect(page.getByRole('heading', { name: 'Edit your pay period dates' })).toBeVisible()
  await expect(page.getByLabel('First day of the pay period')).toHaveValue('2026-09-07')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('#main')).toBeVisible()

  await page.locator('#prev-period-button').focus()
  const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await page.keyboard.press(tabKey)
  await expect(page.locator('#next-period-button')).toBeFocused()
  await page.keyboard.press(tabKey)
  await expect(page.locator('#today-period-button')).toBeFocused()

  const criticalTargets = [
    '#edit-dates-button',
    '#refresh-button',
    '#prev-period-button',
    '#today-period-button',
    '#next-period-button',
    '#hours-2026-09-14-heavy-duty',
    '#hours-2026-09-14-automotive',
    '#hours-2026-09-14-customer',
    '#note-2026-09-14-customer',
    '#hours-2026-09-20-customer',
  ]
  for (const selector of criticalTargets) {
    const target = page.locator(selector)
    await target.scrollIntoViewIfNeeded()
    const result = await target.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        label: node.textContent?.trim() || node.getAttribute('aria-label') || node.id,
        width: rect.width,
        height: rect.height,
        hits: hit === node || node.contains(hit),
      }
    })
    expect(result.height, `${result.label} height`).toBeGreaterThanOrEqual(48)
    expect(result.width, `${result.label} width`).toBeGreaterThanOrEqual(48)
    expect(result.hits, `${result.label} centre hit`).toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('keeps the end-of-period reminder large and on screen', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('my-hours:v1', JSON.stringify({
      version: 1,
      anchorStartKey: '2026-09-07',
      lengthDays: 14,
      entries: { '2026-09-19': 8, '2026-09-20': 7.5 },
    }))
  })
  await openAt(page, SUNDAY)

  const reminder = page.locator('#reminder')
  await expect(reminder).toBeVisible()
  await expect(reminder).toContainText('Pay period ends today')
  await expect(reminder).toContainText('15.5 hours')
  // Version 1 hours (one number per day) survive the upgrade as "No category", not guessed into a category.
  await expect(categoryTotal(page, 'earlier')).toHaveText('15.5 hours')
  await expect(categoryTotal(page, 'heavy-duty')).toHaveText('0 hours')
  await expect(page.locator('#hours-2026-09-20-earlier')).toHaveValue('7.5')
  await expect(page.locator('#hours-2026-09-18-earlier')).toHaveCount(0)
  const position = await reminder.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, scrollY }
  })
  expect(position.scrollY).toBe(0)
  expect(position.top).toBeGreaterThanOrEqual(0)
  expect(position.bottom).toBeLessThanOrEqual(position.viewport)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await page.reload()
  await expect(reminder).toBeVisible()
  const afterReload = await reminder.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, scrollY }
  })
  expect(afterReload.scrollY).toBe(0)
  expect(afterReload.top).toBeGreaterThanOrEqual(0)
  expect(afterReload.bottom).toBeLessThanOrEqual(afterReload.viewport)
})

test('warns plainly when the phone refuses to save', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'my-hours:v1') throw new DOMException('Storage full', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await openAt(page, MONDAY)
  await completeSetup(page)
  await expect(page.locator('#save-status')).toContainText('Could not save on this phone')
  await expect(page.locator('#save-status')).not.toContainText('Saved')
})

test('works offline after the first visit', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'One service-worker smoke test is sufficient; UI runs in WebKit above.')
  await openAt(page, MONDAY)
  await completeSetup(page)
  await page.locator('#hours-2026-09-14-customer').fill('8')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.locator('#total-value')).toHaveText('8 hours')

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'My Hours' })).toBeVisible()
  await expect(page.locator('#total-value')).toHaveText('8 hours')
})
