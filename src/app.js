// My Hours — phone-first Classic interface.
// All date math and storage live in ./core/hours.js (owned by c1). This file only renders and wires events.

import {
  dateKey,
  parseDateKey,
  inclusiveDays,
  periodForDate,
  shiftPeriod,
  sanitizeHours,
  totalHours,
  loadState,
  saveState,
} from './core/hours.js'

const MAX_PERIOD_DAYS = 31
const DEFAULT_PERIOD_DAYS = 14

// ---------- state ----------
// Expected shape from core: { version, anchorStartKey, lengthDays, entries: { [dateKey]: number } }
// Access is centralised in readSchedule/writeSchedule/readEntries so an integration change is one edit.

const storage = safeStorage()
let state = loadState(storage)
let period = null // { startKey, endKey, dates }
let saveTimer = null

function safeStorage() {
  try {
    const s = window.localStorage
    s.getItem('my-hours:probe')
    return s
  } catch {
    // Private mode or blocked storage: keep the app usable for this visit.
    const mem = new Map()
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    }
  }
}

function readSchedule() {
  const anchorStartKey = state && typeof state.anchorStartKey === 'string' ? state.anchorStartKey : null
  const lengthDays = state && Number.isInteger(state.lengthDays) && state.lengthDays > 0 ? state.lengthDays : null
  return anchorStartKey && lengthDays ? { anchorStartKey, lengthDays } : null
}

function writeSchedule(anchorStartKey, lengthDays) {
  state = { ...state, anchorStartKey, lengthDays }
  persist()
}

function readEntries() {
  if (!state || typeof state.entries !== 'object' || state.entries === null) return {}
  return state.entries
}

function writeEntry(key, hours) {
  const entries = { ...readEntries() }
  if (hours === null) delete entries[key]
  else entries[key] = hours
  state = { ...state, entries }
  persist()
}

function persist() {
  saveState(storage, state)
}

// ---------- elements ----------
const el = {
  editDatesButton: document.getElementById('edit-dates-button'),
  refreshButton: document.getElementById('refresh-button'),
  setup: document.getElementById('setup'),
  setupTitle: document.getElementById('setup-title'),
  setupForm: document.getElementById('setup-form'),
  startInput: document.getElementById('start-date'),
  endInput: document.getElementById('end-date'),
  startError: document.getElementById('start-error'),
  endError: document.getElementById('end-error'),
  setupSummary: document.getElementById('setup-summary'),
  cancelDatesButton: document.getElementById('cancel-dates-button'),
  main: document.getElementById('main'),
  reminder: document.getElementById('reminder'),
  reminderTotal: document.getElementById('reminder-total'),
  periodTitle: document.getElementById('period-title'),
  periodKicker: document.getElementById('period-kicker'),
  periodRange: document.getElementById('period-range'),
  prevButton: document.getElementById('prev-period-button'),
  todayButton: document.getElementById('today-period-button'),
  nextButton: document.getElementById('next-period-button'),
  dayList: document.getElementById('day-list'),
  totalBar: document.getElementById('total-bar'),
  totalValue: document.getElementById('total-value'),
  saveStatus: document.getElementById('save-status'),
}

// ---------- formatting (display only, no date math) ----------
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const shortDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const rangeDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function todayKey() {
  return dateKey(new Date())
}

function formatHours(n) {
  const rounded = Math.round(n * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '')
  return `${text} ${rounded === 1 ? 'hour' : 'hours'}`
}

function formatRange(startKey, endKey) {
  return `${rangeDate.format(parseDateKey(startKey))} to ${rangeDate.format(parseDateKey(endKey))}`
}

function periodLabel(startKey, endKey) {
  const t = todayKey()
  if (t >= startKey && t <= endKey) return 'This pay period'
  return t > endKey ? 'Past pay period' : 'Upcoming pay period'
}

// ---------- setup / edit dates ----------
function openSetup({ editing }) {
  const schedule = readSchedule()
  el.setupTitle.textContent = editing ? 'Edit your pay period dates' : 'Set your pay period'
  el.cancelDatesButton.hidden = !editing
  clearFieldErrors()
  if (schedule) {
    const current = periodForDate(schedule.anchorStartKey, schedule.lengthDays, new Date())
    el.startInput.value = current.startKey
    el.endInput.value = current.endKey
  } else {
    el.startInput.value = ''
    el.endInput.value = ''
  }
  updateSetupSummary()
  el.main.hidden = true
  el.totalBar.hidden = true
  el.editDatesButton.hidden = true
  el.refreshButton.hidden = true
  el.setup.hidden = false
  el.setupTitle.focus()
}

function closeSetup() {
  el.setup.hidden = true
  el.main.hidden = false
  el.totalBar.hidden = false
  el.editDatesButton.hidden = false
  el.refreshButton.hidden = false
}

function clearFieldErrors() {
  for (const [input, error] of [[el.startInput, el.startError], [el.endInput, el.endError]]) {
    error.hidden = true
    error.textContent = ''
    input.removeAttribute('aria-invalid')
  }
}

function showFieldError(input, error, message) {
  error.textContent = message
  error.hidden = false
  input.setAttribute('aria-invalid', 'true')
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDateKey(value).getTime())
}

function validateSetup() {
  clearFieldErrors()
  const start = el.startInput.value
  const end = el.endInput.value
  let ok = true
  if (!isDateKey(start)) {
    showFieldError(el.startInput, el.startError, 'Please choose the first day of the pay period.')
    ok = false
  }
  if (!isDateKey(end)) {
    showFieldError(el.endInput, el.endError, 'Please choose the last day of the pay period.')
    ok = false
  }
  if (!ok) return null
  const days = inclusiveDays(start, end)
  if (days < 1) {
    showFieldError(el.endInput, el.endError, 'The last day must be the same day as the first day, or after it.')
    return null
  }
  if (days > MAX_PERIOD_DAYS) {
    showFieldError(el.endInput, el.endError, `A pay period can be at most ${MAX_PERIOD_DAYS} days long. This one is ${days} days.`)
    return null
  }
  return { start, end, days }
}

function updateSetupSummary() {
  const start = el.startInput.value
  const end = el.endInput.value
  if (isDateKey(start) && isDateKey(end)) {
    const days = inclusiveDays(start, end)
    if (days >= 1 && days <= MAX_PERIOD_DAYS) {
      el.setupSummary.textContent = `That is a ${days}-day pay period. It will repeat every ${days} days.`
      return
    }
  }
  el.setupSummary.textContent = ''
}

el.startInput.addEventListener('change', () => {
  // Default the end date to 13 days after the start (a 14-day period) when the end is blank or before the start.
  const start = el.startInput.value
  if (isDateKey(start)) {
    const end = el.endInput.value
    if (!isDateKey(end) || inclusiveDays(start, end) < 1) {
      const defaultPeriod = periodForDate(start, DEFAULT_PERIOD_DAYS, parseDateKey(start))
      el.endInput.value = defaultPeriod.endKey
    }
  }
  updateSetupSummary()
})

el.endInput.addEventListener('change', updateSetupSummary)

el.setupForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const result = validateSetup()
  if (!result) {
    const firstInvalid = el.setupForm.querySelector('[aria-invalid="true"]')
    if (firstInvalid) firstInvalid.focus()
    return
  }
  writeSchedule(result.start, result.days)
  closeSetup()
  showPeriodForToday()
  announce(`Dates saved. Showing ${formatRange(period.startKey, period.endKey)}.`)
})

el.cancelDatesButton.addEventListener('click', () => {
  closeSetup()
  render()
  el.periodTitle.focus()
})

el.editDatesButton.addEventListener('click', () => openSetup({ editing: true }))

// ---------- period navigation ----------
function showPeriodForToday() {
  const schedule = readSchedule()
  period = periodForDate(schedule.anchorStartKey, schedule.lengthDays, new Date())
  render()
  scrollTodayIntoView()
}

el.prevButton.addEventListener('click', () => {
  period = shiftPeriod(period, -1)
  render()
  announce(`Showing ${formatRange(period.startKey, period.endKey)}.`)
  el.periodTitle.focus()
})

el.nextButton.addEventListener('click', () => {
  period = shiftPeriod(period, 1)
  render()
  announce(`Showing ${formatRange(period.startKey, period.endKey)}.`)
  el.periodTitle.focus()
})

el.todayButton.addEventListener('click', () => {
  showPeriodForToday()
  announce(`Showing today, ${longDate.format(new Date())}.`)
  const todayInput = el.dayList.querySelector('input[data-today="true"]')
  if (todayInput) todayInput.focus()
  else el.periodTitle.focus()
})

el.refreshButton.addEventListener('click', () => {
  state = loadState(storage)
  if (!readSchedule()) {
    openSetup({ editing: false })
    return
  }
  showPeriodForToday()
  announce('Refreshed. Your saved hours are up to date.')
  el.periodTitle.focus()
})

// ---------- rendering ----------
function render() {
  if (!period) return
  const entries = readEntries()
  const t = todayKey()

  el.periodKicker.textContent = periodLabel(period.startKey, period.endKey)
  el.periodRange.textContent = formatRange(period.startKey, period.endKey)
  document.title = `My Hours — ${formatRange(period.startKey, period.endKey)}`

  el.dayList.replaceChildren(...period.dates.map((date) => renderDayRow(date, entries, t)))
  renderTotal()
  renderReminder(t)
}

function renderDayRow(date, entries, t) {
  const key = dateKey(date)
  const isToday = key === t
  const saved = entries[key]

  const li = document.createElement('li')
  li.className = 'day-row'
  if (isToday) li.classList.add('is-today')
  li.dataset.key = key

  const label = document.createElement('label')
  label.className = 'day-label'
  label.htmlFor = `hours-${key}`

  const dayName = document.createElement('span')
  dayName.className = 'day-name'
  dayName.textContent = shortDate.format(date)
  label.append(dayName)

  const sr = document.createElement('span')
  sr.className = 'visually-hidden'
  sr.textContent = ` — hours worked, ${longDate.format(date)}`
  label.append(sr)

  if (isToday) {
    const badge = document.createElement('span')
    badge.className = 'today-badge'
    badge.textContent = 'Today'
    label.append(badge)
  }

  const input = document.createElement('input')
  input.type = 'text'
  input.inputMode = 'decimal'
  input.autocomplete = 'off'
  input.enterKeyHint = 'done'
  input.id = `hours-${key}`
  input.name = `hours-${key}`
  input.className = 'hours-input'
  input.placeholder = '—'
  input.setAttribute('aria-describedby', `hours-hint hours-${key}-error`)
  input.dataset.key = key
  if (isToday) {
    input.dataset.today = 'true'
    li.setAttribute('aria-current', 'date')
  }
  input.value = typeof saved === 'number' ? trimNumber(saved) : ''

  const unit = document.createElement('span')
  unit.className = 'hours-unit'
  unit.setAttribute('aria-hidden', 'true')
  unit.textContent = 'hours'

  const error = document.createElement('p')
  error.className = 'field-error day-error'
  error.id = `hours-${key}-error`
  error.hidden = true

  const control = document.createElement('div')
  control.className = 'day-control'
  control.append(input, unit)

  li.append(label, control, error)

  input.addEventListener('input', () => handleHoursInput(input, error, date))
  input.addEventListener('blur', () => handleHoursBlur(input, error, date))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      input.blur()
    }
  })
  return li
}

function trimNumber(n) {
  const rounded = Math.round(n * 100) / 100
  return String(rounded)
}

function handleHoursInput(input, error, date) {
  const raw = input.value.trim()
  const hours = sanitizeHours(raw)
  const invalid = raw !== '' && hours === null
  if (invalid) {
    error.textContent = 'Please enter a number from 0 to 24, like 8 or 7.5.'
    error.hidden = false
    input.setAttribute('aria-invalid', 'true')
    announce('')
    return
  }
  error.hidden = true
  error.textContent = ''
  input.removeAttribute('aria-invalid')
  writeEntry(dateKey(date), hours)
  renderTotal()
  renderReminder(todayKey())
  const dayText = shortDate.format(date)
  announceSoon(hours === null ? `Cleared ${dayText}.` : `Saved ${formatHours(hours)} for ${dayText}.`)
}

function handleHoursBlur(input, error, date) {
  const raw = input.value.trim()
  const hours = sanitizeHours(raw)
  if (raw !== '' && hours === null) {
    // Leave the typed text so the person can see and fix it; the message stays visible.
    return
  }
  if (hours !== null) input.value = trimNumber(hours)
  error.hidden = true
  input.removeAttribute('aria-invalid')
}

function renderTotal() {
  const entries = readEntries()
  const total = totalHours(entries, period.dates)
  const filled = period.dates.filter((d) => typeof entries[dateKey(d)] === 'number').length
  el.totalValue.textContent = formatHours(total)
  el.totalValue.dataset.total = String(total)
  el.totalValue.setAttribute('aria-label', `Total this period: ${formatHours(total)} across ${filled} ${filled === 1 ? 'day' : 'days'} entered`)
}

function renderReminder(t) {
  const schedule = readSchedule()
  if (!schedule) {
    el.reminder.hidden = true
    return
  }
  const todaysPeriod = periodForDate(schedule.anchorStartKey, schedule.lengthDays, new Date())
  const isFinalDay = t === todaysPeriod.endKey
  const viewingTodaysPeriod = period.startKey === todaysPeriod.startKey
  if (!isFinalDay || !viewingTodaysPeriod) {
    el.reminder.hidden = true
    return
  }
  const total = totalHours(readEntries(), todaysPeriod.dates)
  el.reminderTotal.textContent = `Your total for this period is ${formatHours(total)}.`
  el.reminder.hidden = false
}

function scrollTodayIntoView() {
  const row = el.dayList.querySelector('.day-row.is-today')
  if (!row) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
}

// ---------- status announcements ----------
function announce(message) {
  clearTimeout(saveTimer)
  el.saveStatus.textContent = message
}

function announceSoon(message) {
  // Coalesce rapid keystrokes so a screen reader hears one "Saved" per pause, not per character.
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    el.saveStatus.textContent = message
  }, 400)
}

// ---------- boot ----------
function boot() {
  if (!readSchedule()) {
    openSetup({ editing: false })
    return
  }
  closeSetup()
  showPeriodForToday()
}

boot()

// Offline shell: the service worker itself is provided by the integration slice (public/sw.js).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* No service worker yet; the app still works online. */
    })
  })
}
