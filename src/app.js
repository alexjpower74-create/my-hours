// My Hours — phone-first Classic interface.
// All date math and storage live in ./core/hours.js (owned by c1). This file only renders and wires events.

import {
  dateKey,
  parseDateKey,
  isDateKey,
  inclusiveDays,
  periodForDate,
  shiftPeriod,
  sanitizeHours,
  totalHours,
  categoryTotals,
  sanitizeNote,
  loadState,
  saveState,
  CATEGORIES,
  EARLIER_CATEGORY,
  MAX_NOTE_LENGTH,
} from './core/hours.js'

const MAX_PERIOD_DAYS = 31
const DEFAULT_PERIOD_DAYS = 14
const SAVE_FAILED_MESSAGE = 'Could not save on this phone. Your hours may be lost when you close this page.'

// ---------- state ----------
// Core state shape: { version, anchorStartKey, lengthDays,
//   entries: { [dateKey]: { [categoryId]: number } }, notes: { [dateKey]: { [categoryId]: string } } }
// period.dates is an array of "YYYY-MM-DD" keys; keys are used directly and parsed only for display.

// Chromium restores the previous scroll position on reload, which can hide the final-day reminder.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

const storage = safeStorage()
let state = loadState(storage)
let period = null // { startKey, endKey, dates: string[] }
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
  return persist()
}

function readEntries() {
  if (!state || typeof state.entries !== 'object' || state.entries === null) return {}
  return state.entries
}

function readNotes() {
  if (!state || typeof state.notes !== 'object' || state.notes === null) return {}
  return state.notes
}

// Set or clear one category's value for one day inside entries or notes, dropping days left empty.
function withDayValue(map, key, categoryId, value) {
  const next = { ...map }
  const day = { ...(next[key] || {}) }
  if (value === null) delete day[categoryId]
  else day[categoryId] = value
  if (Object.keys(day).length > 0) next[key] = day
  else delete next[key]
  return next
}

function writeEntry(key, categoryId, hours) {
  state = { ...state, entries: withDayValue(readEntries(), key, categoryId, hours) }
  return persist()
}

function writeNote(key, categoryId, note) {
  state = { ...state, notes: withDayValue(readNotes(), key, categoryId, note) }
  return persist()
}

// Returns true when the device kept the data. false means storage is missing, read-only or full.
function persist() {
  return saveState(storage, state) === true
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
  categoryTotals: document.getElementById('category-totals'),
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

function formatDay(key, formatter) {
  return formatter.format(parseDateKey(key))
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
  const saved = writeSchedule(result.start, result.days)
  closeSetup()
  showPeriodForToday()
  announce(saved ? `Dates saved. Showing ${formatRange(period.startKey, period.endKey)}.` : SAVE_FAILED_MESSAGE)
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

  el.dayList.replaceChildren(...period.dates.map((key) => renderDayRow(key, entries, t)))
  renderTotal()
  renderReminder(t)
}

function renderDayRow(key, entries, t) {
  const isToday = key === t
  const day = entries[key] || {}
  const dayNotes = readNotes()[key] || {}

  const li = document.createElement('li')
  li.className = 'day-row'
  if (isToday) {
    li.classList.add('is-today')
    li.setAttribute('aria-current', 'date')
  }
  li.dataset.key = key

  const heading = document.createElement('h3')
  heading.className = 'day-label'

  const dayName = document.createElement('span')
  dayName.className = 'day-name'
  dayName.textContent = formatDay(key, shortDate)
  heading.append(dayName)

  const sr = document.createElement('span')
  sr.className = 'visually-hidden'
  sr.textContent = ` — ${formatDay(key, longDate)}`
  heading.append(sr)

  if (isToday) {
    const badge = document.createElement('span')
    badge.className = 'today-badge'
    badge.textContent = 'Today'
    heading.append(badge)
  }
  li.append(heading)

  // Hours typed before categories existed get their own row only on days that have them.
  const categories = typeof day[EARLIER_CATEGORY.id] === 'number' ? [...CATEGORIES, EARLIER_CATEGORY] : CATEGORIES
  for (const category of categories) {
    li.append(renderCategory(key, category, day[category.id], dayNotes[category.id], isToday))
  }
  return li
}

function renderCategory(key, category, saved, savedNote, isToday) {
  const id = `${key}-${category.id}`
  const block = document.createElement('div')
  block.className = 'category'
  block.dataset.category = category.id

  const label = document.createElement('label')
  label.className = 'category-name'
  label.htmlFor = `hours-${id}`
  label.textContent = category.label
  const sr = document.createElement('span')
  sr.className = 'visually-hidden'
  sr.textContent = ` — hours worked, ${formatDay(key, longDate)}`
  label.append(sr)

  const input = document.createElement('input')
  input.type = 'text'
  input.inputMode = 'decimal'
  input.autocomplete = 'off'
  input.enterKeyHint = 'next'
  input.id = `hours-${id}`
  input.name = `hours-${id}`
  input.className = 'hours-input'
  input.placeholder = '—'
  input.setAttribute('aria-describedby', `hours-hint hours-${id}-error`)
  input.dataset.key = key
  input.dataset.category = category.id
  if (isToday) input.dataset.today = 'true'
  input.value = typeof saved === 'number' ? trimNumber(saved) : ''

  const unit = document.createElement('span')
  unit.className = 'hours-unit'
  unit.setAttribute('aria-hidden', 'true')
  unit.textContent = 'hours'

  const control = document.createElement('div')
  control.className = 'day-control'
  control.append(input, unit)

  const error = document.createElement('p')
  error.className = 'field-error day-error'
  error.id = `hours-${id}-error`
  error.hidden = true

  const noteLabel = document.createElement('label')
  noteLabel.className = 'visually-hidden'
  noteLabel.htmlFor = `note-${id}`
  noteLabel.textContent = `Note for ${category.label}, ${formatDay(key, longDate)}`

  const note = document.createElement('textarea')
  note.id = `note-${id}`
  note.name = `note-${id}`
  note.className = 'note-input'
  note.rows = 1
  note.maxLength = MAX_NOTE_LENGTH
  note.placeholder = 'Note'
  note.value = typeof savedNote === 'string' ? savedNote : ''

  block.append(label, control, error, noteLabel, note)

  input.addEventListener('input', () => handleHoursInput(input, error, key, category))
  input.addEventListener('blur', () => handleHoursBlur(input, error))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const inputs = [...el.dayList.querySelectorAll('.hours-input')]
      const next = inputs[inputs.indexOf(input) + 1]
      if (next) next.focus()
      else input.blur()
    }
  })
  note.addEventListener('input', () => {
    fitNote(note)
    handleNoteInput(note, key, category)
  })
  // Grow saved multi-line notes once the row is on the page.
  requestAnimationFrame(() => fitNote(note))
  return block
}

function fitNote(note) {
  note.style.height = 'auto'
  note.style.height = `${note.scrollHeight + 6}px`
}

function handleNoteInput(note, key, category) {
  const text = sanitizeNote(note.value)
  const saved = writeNote(key, category.id, text)
  if (!saved) {
    announce(SAVE_FAILED_MESSAGE)
    return
  }
  const dayText = formatDay(key, shortDate)
  announceSoon(text === null ? `Cleared the ${category.label} note for ${dayText}.` : `Saved the ${category.label} note for ${dayText}.`)
}

function trimNumber(n) {
  const rounded = Math.round(n * 100) / 100
  return String(rounded)
}

function handleHoursInput(input, error, key, category) {
  const raw = input.value.trim()
  const hours = sanitizeHours(raw)
  const invalid = raw !== '' && hours === null
  if (invalid) {
    error.textContent = 'Please enter a number from 0 to 24, like 8 or 7.5.'
    error.hidden = false
    input.setAttribute('aria-invalid', 'true')
    // Drop any earlier valid value for this day so a half-typed "25" or "8x" is never counted or restored.
    const wasStored = typeof readEntries()[key]?.[category.id] === 'number'
    if (wasStored) {
      const saved = writeEntry(key, category.id, null)
      renderTotal()
      renderReminder(todayKey())
      if (!saved) {
        announce(SAVE_FAILED_MESSAGE)
        return
      }
    }
    announce('')
    return
  }
  error.hidden = true
  error.textContent = ''
  input.removeAttribute('aria-invalid')
  const saved = writeEntry(key, category.id, hours)
  renderTotal()
  renderReminder(todayKey())
  if (!saved) {
    announce(SAVE_FAILED_MESSAGE)
    return
  }
  const dayText = formatDay(key, shortDate)
  announceSoon(hours === null ? `Cleared ${category.label} for ${dayText}.` : `Saved ${formatHours(hours)} of ${category.label} for ${dayText}.`)
}

function handleHoursBlur(input, error) {
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
  const totals = categoryTotals(entries, period.dates)
  const filled = period.dates.filter((key) => entries[key] && Object.keys(entries[key]).length > 0).length

  // Earlier (no category) hours only get a total box in a period that has some.
  const showEarlier = period.dates.some((key) => typeof entries[key]?.[EARLIER_CATEGORY.id] === 'number')
  const categories = showEarlier ? [...CATEGORIES, EARLIER_CATEGORY] : CATEGORIES
  el.categoryTotals.replaceChildren(...categories.map((category) => {
    const item = document.createElement('li')
    item.className = 'category-total'
    item.dataset.category = category.id
    const label = document.createElement('span')
    label.className = 'category-total-label'
    label.textContent = category.label
    const value = document.createElement('span')
    value.className = 'category-total-value'
    value.dataset.total = String(totals[category.id])
    value.textContent = formatHours(totals[category.id])
    item.append(label, value)
    return item
  }))

  el.totalValue.textContent = formatHours(totals.all)
  el.totalValue.dataset.total = String(totals.all)
  const parts = categories.map((category) => `${category.label} ${formatHours(totals[category.id])}`).join(', ')
  el.totalValue.setAttribute('aria-label', `Total this period: ${formatHours(totals.all)} across ${filled} ${filled === 1 ? 'day' : 'days'} entered. ${parts}.`)
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
  // On the final day the big reminder sits at the top; show it instead of scrolling to today's row.
  if (!el.reminder.hidden) {
    window.scrollTo(0, 0)
    return
  }
  const row = el.dayList.querySelector('.day-row.is-today')
  if (!row) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
}

// ---------- status announcements ----------
function announce(message) {
  clearTimeout(saveTimer)
  el.saveStatus.textContent = message
  el.saveStatus.classList.toggle('is-error', message === SAVE_FAILED_MESSAGE)
}

function announceSoon(message) {
  // Coalesce rapid keystrokes so a screen reader hears one "Saved" per pause, not per character.
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => announce(message), 400)
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

// An installed app left open past midnight: when it comes back to the foreground, re-check which day is today.
let renderedTodayKey = todayKey()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  if (todayKey() === renderedTodayKey) return
  renderedTodayKey = todayKey()
  if (!readSchedule() || !el.setup.hidden) return
  showPeriodForToday()
  announce(`It is now ${longDate.format(new Date())}.`)
})

// Offline shell: the service worker itself is provided by the integration slice (public/sw.js).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* No service worker yet; the app still works online. */
    })
  })
}
