// Hybrid cadence + automation schedule math. Dependency-free and pure (all
// "today" values are parameters) so it stays importable from client
// components and testable with fake dates. Dates are YYYY-MM-DD strings
// throughout; calendar arithmetic uses Date.UTC so DST can never shift a day.
//
// Cadence model (groups.cadence_unit / cadence_interval / cadence_anchor_day):
//   day   → every `interval` days (weekly 7, biweekly 14)
//   month → every `interval` months on day-of-month `anchor_day`, clamped to
//           the month's length (31 → Feb 28/29, → 30 in 30-day months)
//
// A group_schedules row plans one window (the candidate-date span of the next
// auto poll) at a time: month unit → a full calendar month; day unit → one
// cadence period of `interval` days. The poll is sent before the window
// starts (month → on send_day_of_month of the prior month, clamped; day →
// lead_days before window start) with deadline = send + deadline_days, always
// strictly before the window starts.

export const CADENCE_PRESETS = { day: [7, 14], month: [1, 2, 3] }

// UI preset list. `value` is the <select> key; month presets also need an
// anchor day-of-month picked alongside.
export const CADENCE_CHOICES = [
    { value: 'day-7', unit: 'day', interval: 7, label: 'Weekly' },
    { value: 'day-14', unit: 'day', interval: 14, label: 'Every 2 weeks' },
    { value: 'month-1', unit: 'month', interval: 1, label: 'Monthly' },
    { value: 'month-2', unit: 'month', interval: 2, label: 'Every 2 months' },
    { value: 'month-3', unit: 'month', interval: 3, label: 'Quarterly' },
]

export function cadenceChoiceValue(group) {
    if (!group?.cadence_unit) return ''
    return `${group.cadence_unit}-${group.cadence_interval}`
}

export function cadenceFromChoice(value, anchorDay) {
    if (!value) return null
    const choice = CADENCE_CHOICES.find((item) => item.value === value)
    if (!choice) return null
    return {
        unit: choice.unit,
        interval: choice.interval,
        anchor_day: choice.unit === 'month' ? anchorDay : null,
    }
}

const MAX_EXCLUDED_WEEKDAYS = 6 // never allow blocking all seven days

function parts(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number)
    return { y, m0: m - 1, d }
}

function fmt(y, m0, d) {
    return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10)
}

export function addDaysStr(dateStr, n) {
    const { y, m0, d } = parts(dateStr)
    return fmt(y, m0, d + n)
}

export function daysInMonth(y, m0) {
    return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

// Day-of-month clamped to the month's length: 31 → Feb 28/29, → Apr 30, etc.
export function clampedDateInMonth(y, m0, day) {
    return fmt(y, m0, Math.min(day, daysInMonth(y, m0)))
}

export function monthStartOf(dateStr) {
    const { y, m0 } = parts(dateStr)
    return fmt(y, m0, 1)
}

export function monthEndOf(dateStr) {
    const { y, m0 } = parts(dateStr)
    return fmt(y, m0, daysInMonth(y, m0))
}

// Month arithmetic is only ever done on day-1 anchors, so clamping ambiguity
// (Jan 31 + 1 month) can't arise.
export function addMonthsToMonthStart(monthStartStr, months) {
    const { y, m0 } = parts(monthStartStr)
    return fmt(y, m0 + months, 1)
}

export function weekdayOf(dateStr) {
    const { y, m0, d } = parts(dateStr)
    return new Date(Date.UTC(y, m0, d)).getUTCDay() // 0=Sun..6=Sat
}

export function minDate(a, b) {
    return a <= b ? a : b
}

export function maxDate(a, b) {
    return a >= b ? a : b
}

// ---------------------------------------------------------------------------
// Cadence

// Validates a cadence payload ({unit, interval, anchor_day} or null=clear).
export function validateCadence(cadence) {
    if (cadence === null) return { ok: true, cadence: null }
    if (!cadence || typeof cadence !== 'object') {
        return { error: 'Invalid cadence.' }
    }
    const { unit, interval } = cadence
    if (!CADENCE_PRESETS[unit] || !CADENCE_PRESETS[unit].includes(interval)) {
        return { error: 'Invalid cadence.' }
    }
    if (unit === 'month') {
        const anchorDay = cadence.anchor_day
        if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
            return { error: 'Monthly cadence needs a day of the month (1–31).' }
        }
        return { ok: true, cadence: { unit, interval, anchor_day: anchorDay } }
    }
    return { ok: true, cadence: { unit, interval, anchor_day: null } }
}

export function describeCadence(group) {
    if (!group?.cadence_unit) return null
    if (group.cadence_unit === 'day') {
        return group.cadence_interval === 7 ? 'Weekly' : `Every ${group.cadence_interval} days`
    }
    if (group.cadence_interval === 1) return `Monthly (around the ${ordinal(group.cadence_anchor_day)})`
    return `Every ${group.cadence_interval} months (around the ${ordinal(group.cadence_anchor_day)})`
}

function ordinal(n) {
    if (!n) return ''
    const rem10 = n % 10
    const rem100 = n % 100
    if (rem10 === 1 && rem100 !== 11) return `${n}st`
    if (rem10 === 2 && rem100 !== 12) return `${n}nd`
    if (rem10 === 3 && rem100 !== 13) return `${n}rd`
    return `${n}th`
}

// ---------------------------------------------------------------------------
// Windows and send dates

// The window a poll covers, given its start. Month windows always start on a
// month's day 1 and span the whole month; day windows span one cadence period.
export function deriveWindow(group, windowStart) {
    if (group.cadence_unit === 'month') {
        return { windowStart, windowEnd: monthEndOf(windowStart) }
    }
    return { windowStart, windowEnd: addDaysStr(windowStart, group.cadence_interval - 1) }
}

// When the poll for a window goes out. Month: send_day_of_month of the month
// BEFORE the window, clamped. Day: lead_days before the window starts.
export function computeSendDate(group, schedule, windowStart) {
    if (group.cadence_unit === 'month') {
        const prevMonth = addMonthsToMonthStart(windowStart, -1)
        const { y, m0 } = parts(prevMonth)
        return clampedDateInMonth(y, m0, schedule.send_day_of_month)
    }
    return addDaysStr(windowStart, -schedule.lead_days)
}

export function advanceWindowStart(group, windowStart) {
    if (group.cadence_unit === 'month') {
        return addMonthsToMonthStart(windowStart, group.cadence_interval)
    }
    return addDaysStr(windowStart, group.cadence_interval)
}

// Full cursor ({next_window_start, next_window_end, next_send_on}) for a
// given window start.
export function computeCursor(group, schedule, windowStart) {
    const { windowEnd } = deriveWindow(group, windowStart)
    return {
        next_window_start: windowStart,
        next_window_end: windowEnd,
        next_send_on: computeSendDate(group, schedule, windowStart),
    }
}

// The first window after enabling automation (also used to re-anchor on
// resume or cadence change). The anchor event covers the CURRENT period, so
// the first auto window is the FOLLOWING one; with no event, the next period
// from today. Windows that already started are skipped — automation never
// fires for a period already underway.
export function computeFirstWindow(group, schedule, { anchorEvent = null, today }) {
    let windowStart
    if (group.cadence_unit === 'month') {
        const base = anchorEvent ? monthStartOf(anchorEvent.date_range_start) : monthStartOf(today)
        windowStart = addMonthsToMonthStart(base, group.cadence_interval)
    } else if (anchorEvent) {
        windowStart = addDaysStr(anchorEvent.date_range_end, 1)
    } else {
        // First poll goes out on the next cron run.
        windowStart = addDaysStr(today, schedule.lead_days)
    }

    while (windowStart <= today) {
        windowStart = advanceWindowStart(group, windowStart)
    }

    return computeCursor(group, schedule, windowStart)
}

// Every window date falling on an excluded weekday → the generated event's
// blocked_dates.
export function buildBlockedDates(windowStart, windowEnd, excludedWeekdays) {
    const excluded = new Set(excludedWeekdays || [])
    if (excluded.size === 0) return []
    const blocked = []
    for (let date = windowStart; date <= windowEnd; date = addDaysStr(date, 1)) {
        if (excluded.has(weekdayOf(date))) blocked.push(date)
    }
    return blocked
}

function shortDate(dateStr, withYear = false) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' } : {}),
    })
}

// "August 2026" (month unit) or "Aug 12 – Aug 25, 2026" (day unit).
export function formatWindowLabel(group, windowStart, windowEnd) {
    if (group.cadence_unit === 'month') {
        return new Date(windowStart + 'T12:00:00').toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
        })
    }
    return `${shortDate(windowStart)} – ${shortDate(windowEnd, true)}`
}

export function buildAutoTitle(groupName, group, windowStart, windowEnd) {
    return `${groupName} — ${formatWindowLabel(group, windowStart, windowEnd)}`
}

// Deadline for a generated poll: send + deadline_days, clamped to end
// strictly before the window starts (belt-and-braces on top of config-time
// validation; matters when a late catch-up send eats into the gap).
export function computeDeadline(effectiveSendOn, deadlineDays, windowStart) {
    return minDate(addDaysStr(effectiveSendOn, deadlineDays), addDaysStr(windowStart, -1))
}

// The next `count` occurrences a draft config would produce — the same dates
// the save route and daily cron compute. Editing keeps the schedule's planned
// window; a new schedule anchors like the save route does. Only the first
// occurrence can be a catch-up (send date not in the future → the cron sends
// it at its next run).
export function previewOccurrences(group, config, { schedule = null, anchorEvent = null, today, count = 2 }) {
    let windowStart = schedule?.next_window_start
        || computeFirstWindow(group, config, { anchorEvent, today }).next_window_start

    const occurrences = []
    for (let i = 0; i < count; i += 1) {
        const { windowEnd } = deriveWindow(group, windowStart)
        const sendOn = computeSendDate(group, config, windowStart)
        const isCatchUp = i === 0 && sendOn <= today
        const effectiveSendOn = isCatchUp ? maxDate(sendOn, today) : sendOn
        occurrences.push({
            sendOn,
            effectiveSendOn,
            isCatchUp,
            deadlineOn: computeDeadline(effectiveSendOn, config.deadline_days, windowStart),
            windowStart,
            windowEnd,
        })
        windowStart = advanceWindowStart(group, windowStart)
    }
    return occurrences
}

// ---------------------------------------------------------------------------
// Schedule config validation (shared by API routes and the UI preview)

// Month unit: the shortest send→window gap is a non-leap February before a
// March window, so send day S leaves at worst 28 − S days. Requiring
// deadline_days ≤ 28 − S guarantees every generated poll gets ≥1 full
// response day; S ≥ 28 is therefore never configurable (UI caps at 27).
export function maxDeadlineDays(group, { sendDayOfMonth, leadDays }) {
    if (group.cadence_unit === 'month') {
        if (!Number.isInteger(sendDayOfMonth)) return null
        return 28 - Math.min(sendDayOfMonth, 28)
    }
    if (!Number.isInteger(leadDays)) return null
    return leadDays - 1
}

export function validateScheduleConfig(group, config) {
    if (!group?.cadence_unit) {
        return { error: 'Set a cadence for this group before enabling automatic polls.' }
    }

    const excluded = config.excluded_weekdays
    if (!Array.isArray(excluded)
        || excluded.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
        || new Set(excluded).size !== excluded.length
        || excluded.length > MAX_EXCLUDED_WEEKDAYS) {
        return { error: 'Excluded weekdays must leave at least one day available.' }
    }

    const deadlineDays = config.deadline_days
    if (!Number.isInteger(deadlineDays) || deadlineDays < 1) {
        return { error: 'Response window must be at least 1 day.' }
    }

    const notifyEmail = typeof config.notify_email === 'string' ? config.notify_email.trim() : ''
    if (!notifyEmail || !notifyEmail.includes('@')) {
        return { error: 'A notification email is required for automatic polls.' }
    }

    if (group.cadence_unit === 'month') {
        const sendDay = config.send_day_of_month
        if (!Number.isInteger(sendDay) || sendDay < 1 || sendDay > 27) {
            return { error: 'Send day must be between the 1st and the 27th of the month.' }
        }
        const cap = maxDeadlineDays(group, { sendDayOfMonth: sendDay })
        if (deadlineDays > cap) {
            return { error: `With a send day of the ${ordinal(sendDay)}, the response window can be at most ${cap} day${cap === 1 ? '' : 's'} (so the poll always closes before the month it covers).` }
        }
        return {
            ok: true,
            config: {
                excluded_weekdays: [...excluded].sort((a, b) => a - b),
                send_day_of_month: sendDay,
                lead_days: config.lead_days ?? null,
                deadline_days: deadlineDays,
                notify_email: notifyEmail.toLowerCase(),
            },
        }
    }

    const leadDays = config.lead_days
    if (!Number.isInteger(leadDays) || leadDays < 2 || leadDays > 60) {
        return { error: 'Polls must go out 2–60 days before the period they cover.' }
    }
    if (deadlineDays >= leadDays) {
        return { error: `With polls going out ${leadDays} days ahead, the response window must be ${leadDays - 1} day${leadDays === 2 ? '' : 's'} or less.` }
    }
    return {
        ok: true,
        config: {
            excluded_weekdays: [...excluded].sort((a, b) => a - b),
            send_day_of_month: config.send_day_of_month ?? null,
            lead_days: leadDays,
            deadline_days: deadlineDays,
            notify_email: notifyEmail.toLowerCase(),
        },
    }
}
