// Group attendance + recency-weighted score math. Dependency-free (beyond
// lib/attendance) so it stays importable from client components. Nothing here
// is ever stored: the score and the auto attended flag are computed at read
// time, so the formula can change without a backfill.

import { isResponseAvailableOnDate } from './attendance'
import { clampedDateInMonth } from './schedule'

const MS_PER_DAY = 86_400_000
const HALF_LIFE_DAYS = 90

function daysSinceDate(dateStr, now) {
    // Noon UTC per the app-wide date convention.
    const then = new Date(dateStr + 'T12:00:00')
    return Math.max(0, (now.getTime() - then.getTime()) / MS_PER_DAY)
}

// weight = 0.5^(days_since / 90) — exponential decay, 90-day half-life.
export function recencyWeight(selectedDate, now = new Date()) {
    return Math.pow(0.5, daysSinceDate(selectedDate, now) / HALF_LIFE_DAYS)
}

// Computes per-member attendance for a group.
//
//   members          — active group_members rows ({id, participant_id})
//   eventsWithRound  — [{event, round}] countable events only (round has a
//                      selected_date <= today; latest round per event)
//   responsesByEvent — {eventId: [active responses]}
//   attendanceRows   — group_event_attendance rows for the group
//   stillAvailableByRoundResponse — {`${roundId}:${responseId}`: boolean}
//
// Returns { perMember: { [memberId]: { score, count, perEvent: {
//   [eventId]: { auto, override, attended, responseId } } } } }
export function computeGroupAttendance({
    members,
    eventsWithRound,
    responsesByEvent,
    attendanceRows,
    stillAvailableByRoundResponse = {},
    now = new Date(),
}) {
    const attendanceByEventMember = {}
    for (const row of attendanceRows || []) {
        attendanceByEventMember[`${row.event_id}:${row.member_id}`] = row
    }

    const perMember = {}

    for (const member of members || []) {
        let score = 0
        let count = 0
        const perEvent = {}

        for (const { event, round } of eventsWithRound || []) {
            const attendanceRow = attendanceByEventMember[`${event.id}:${member.id}`] || null
            const responses = responsesByEvent[event.id] || []

            // Host-linked response wins over the member's own; both must be active.
            let response = null
            if (attendanceRow?.linked_response_id) {
                response = responses.find((row) => row.id === attendanceRow.linked_response_id) || null
            }
            if (!response) {
                response = responses.find((row) => row.participant_id === member.participant_id) || null
            }

            let auto = false
            if (response && response.confirmed && isResponseAvailableOnDate(response, round.selected_date)) {
                const stillAvailable = stillAvailableByRoundResponse[`${round.id}:${response.id}`]
                auto = stillAvailable !== false
            }

            const override = attendanceRow ? attendanceRow.attended_override : null
            const attended = override ?? auto

            if (attended) {
                score += recencyWeight(round.selected_date, now)
                count += 1
            }

            perEvent[event.id] = { auto, override, attended, responseId: response?.id || null }
        }

        perMember[member.id] = { score, count, perEvent }
    }

    return { perMember }
}

// Read-time cadence nudge: true when the group has a cadence and the next
// hangout is due. Day cadence → last countable event is at least
// cadence_interval days old. Month cadence → today has reached the due date
// (last event's month + cadence_interval months, on the anchor day clamped
// to the month's length).
export function computeCadenceNudge(group, eventsWithRound, now = new Date()) {
    if (!group?.cadence_unit) {
        return { nudge: false, lastDate: null, daysSinceLast: null }
    }

    let lastDate = null
    for (const { round } of eventsWithRound || []) {
        if (!lastDate || round.selected_date > lastDate) lastDate = round.selected_date
    }

    if (!lastDate) {
        return { nudge: true, lastDate: null, daysSinceLast: null }
    }

    const daysSinceLast = Math.floor(daysSinceDate(lastDate, now))

    if (group.cadence_unit === 'day') {
        return { nudge: daysSinceLast >= group.cadence_interval, lastDate, daysSinceLast }
    }

    const [lastYear, lastMonth] = lastDate.split('-').map(Number)
    const dueDate = clampedDateInMonth(
        lastYear,
        lastMonth - 1 + group.cadence_interval,
        group.cadence_anchor_day || 1
    )
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const today = `${now.getFullYear()}-${month}-${day}`
    return { nudge: today >= dueDate, lastDate, daysSinceLast }
}
