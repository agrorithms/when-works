// Pure date-pick + invite-bucketing logic for automatic group scheduling.
// Dependency-free besides sibling pure modules; "today" is always a parameter
// so the cron, the warning-email preview, and tests all compute identically.
//
// All logic here counts CONFIRMED responses only: the respond page mints an
// unconfirmed row the moment a member opens their link, and an unconfirmed
// "unavailable" row would otherwise read as available on every date.
//
// Future (see docs/decisions.md): pickAutoDate becomes strategy-selectable —
// prefer-regulars / prefer-inclusivity weighting once scoring matures.

import { isResponseAvailableOnDate } from './attendance'
import { addDaysStr, maxDate } from './schedule'

export const AUTO_INVITE_SCOPES = ['all', 'responded', 'available']

export const AUTO_INVITE_SCOPE_LABELS = {
    all: 'All group members',
    responded: 'Only members who responded',
    available: 'Only members available on the chosen day',
}

function confirmedResponses(responses) {
    return (responses || []).filter((response) => response.confirmed)
}

// Most-available-wins over the poll's offered dates, ties → earliest.
// Candidates are strictly AFTER `today` — automation never schedules
// same-day or in the past. Returns null when no candidate date has a single
// available confirmed response.
export function pickAutoDate(event, responses, today) {
    const blocked = new Set(event.blocked_dates || [])
    const candidates = confirmedResponses(responses)
    const first = maxDate(event.date_range_start, addDaysStr(today, 1))

    let best = null
    for (let date = first; date <= event.date_range_end; date = addDaysStr(date, 1)) {
        if (blocked.has(date)) continue
        const count = candidates.filter((response) => isResponseAvailableOnDate(response, date)).length
        if (count > 0 && (!best || count > best.count)) {
            best = { date, count }
        }
    }
    return best
}

// Display names of confirmed respondents available on a date (for the
// warning/confirmation emails).
export function availableNamesOn(responses, date) {
    return confirmedResponses(responses)
        .filter((response) => isResponseAvailableOnDate(response, date))
        .map((response) => response.display_name)
}

// Complete roster accounting for the confirmation email. Every active member
// lands in exactly ONE bucket; scope-exclusion reasons take precedence over a
// missing email, so `noEmail` is precisely "would have been emailed, can't
// be". Members in every bucket except `invited` need a manual forward if the
// owner wants them there. `nonMembers` are confirmed respondents who aren't
// on the roster — never auto-invited under any scope, listed so the owner's
// picture is complete.
export function computeInviteBuckets({ members, responses, scope, selectedDate }) {
    const confirmed = confirmedResponses(responses)
    const responseByParticipant = new Map(
        confirmed.filter((r) => r.participant_id).map((r) => [r.participant_id, r])
    )

    const buckets = { invited: [], noEmail: [], notResponded: [], notAvailable: [], nonMembers: [] }

    for (const member of members) {
        const response = responseByParticipant.get(member.participant_id) || null
        if (scope !== 'all' && !response) {
            buckets.notResponded.push(member)
            continue
        }
        if (scope === 'available' && !isResponseAvailableOnDate(response, selectedDate)) {
            buckets.notAvailable.push(member)
            continue
        }
        if (!member.invited_email) {
            buckets.noEmail.push(member)
            continue
        }
        buckets.invited.push(member)
    }

    const memberParticipantIds = new Set(members.map((member) => member.participant_id))
    buckets.nonMembers = confirmed.filter(
        (response) => !response.participant_id || !memberParticipantIds.has(response.participant_id)
    )

    return buckets
}

// HH:MM (24h) — what the time <input> produces and what Postgres TIME
// accepts. Postgres echoes HH:MM:SS back, so normalize before comparing.
export function normalizeEventTime(value) {
    if (typeof value !== 'string') return null
    const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?$/)
    return match ? `${match[1]}:${match[2]}` : null
}

// Validates the auto-scheduling slice of the schedule config. Returns
// normalized columns, or all-nulls-disabled when the feature is off.
export function validateAutoScheduleConfig(body) {
    if (!body.auto_schedule_enabled) {
        return {
            ok: true,
            config: {
                auto_schedule_enabled: false,
                auto_event_time: null,
                auto_event_timezone: null,
                auto_invite_scope: 'available',
            },
        }
    }

    const time = normalizeEventTime(body.auto_event_time)
    if (!time) {
        return { error: 'Auto-scheduling needs an event start time.' }
    }

    const timezone = typeof body.auto_event_timezone === 'string' ? body.auto_event_timezone.trim() : ''
    if (!timezone) {
        return { error: 'Auto-scheduling needs a timezone.' }
    }
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone })
    } catch {
        return { error: 'That timezone is not a valid IANA timezone.' }
    }

    const scope = body.auto_invite_scope
    if (!AUTO_INVITE_SCOPES.includes(scope)) {
        return { error: 'Pick who should receive the calendar invite.' }
    }

    return {
        ok: true,
        config: {
            auto_schedule_enabled: true,
            auto_event_time: time,
            auto_event_timezone: timezone,
            auto_invite_scope: scope,
        },
    }
}
