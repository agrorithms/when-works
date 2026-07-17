// Daily cron (Vercel Cron → vercel.json). Four idempotent tasks, in order:
//   1. auto-create — group polls whose send date has arrived
//   2. pre-send notice — 3-day heads-up when the previous poll is unresolved
//   3. deadline summary — owner email when a poll's deadline has passed
//   4. auto-schedule — Google Calendar event for opted-in polls stamped by a
//      summary at least one full day earlier
// Every cursor/marker mutation is a compare-and-set update, so a double-fired
// or retried invocation can never create two polls, send two summaries, or
// create two calendar events.
// Catch-up semantics throughout (`<= today`): Hobby crons fire once a day at
// a fuzzy time and may effectively miss a day.

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { resolveCronAuth } from '../../../../lib/cronAuth'
import { todayDateString } from '../../../../lib/groups'
import {
    computeCursor,
    advanceWindowStart,
    buildBlockedDates,
    buildAutoTitle,
    computeDeadline,
    maxDate,
    addDaysStr,
} from '../../../../lib/schedule'
import { generateUniqueSlug, createEventCore } from '../../../../lib/eventCreation'
import {
    sendPresendNoticeEmail,
    sendOwnerSummaryEmail,
    sendAutoScheduledEmail,
    sendAutoScheduleFailedEmail,
} from '../../../../lib/email'
import {
    buildOwnerSummary,
    resolveOwnerNotifyEmail,
    claimOwnerSummary,
    buildAutoScheduleContext,
} from '../../../../lib/ownerNotifications'
import { pickAutoDate, computeInviteBuckets, normalizeEventTime } from '../../../../lib/autoSchedule'
import { exchangeRefreshToken, insertCalendarEvent } from '../../../../lib/googleCalendar'
import { recordScheduledDate, hasResolvedRound } from '../../../../lib/hostingRounds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PRESEND_NOTICE_DAYS = 3
const MAX_SKIPPED_WINDOWS = 48

async function runAutoCreate(supabaseAdmin, today, baseUrl) {
    const results = { created: [], skipped: [], errors: [] }

    const { data: schedules, error } = await supabaseAdmin
        .from('group_schedules')
        .select('*, groups(*)')
        .is('paused_at', null)
        .lte('next_send_on', today)

    if (error) {
        results.errors.push(`auto-create query: ${error.message}`)
        return results
    }

    for (const schedule of schedules || []) {
        const group = schedule.groups
        try {
            if (!group?.cadence_unit) {
                results.errors.push(`schedule ${schedule.id}: group missing or has no cadence`)
                continue
            }

            // Windows already underway are stale — automation never creates a
            // poll for a period that has started. Advance past them.
            let windowStart = schedule.next_window_start
            const staleWindows = []
            while (windowStart <= today && staleWindows.length < MAX_SKIPPED_WINDOWS) {
                staleWindows.push(windowStart)
                windowStart = advanceWindowStart(group, windowStart)
            }

            const current = computeCursor(group, schedule, windowStart)

            if (current.next_send_on > today) {
                // Nothing due after skipping — just persist the moved cursor.
                if (staleWindows.length > 0) {
                    await supabaseAdmin
                        .from('group_schedules')
                        .update({
                            ...current,
                            last_error: `Skipped stale window(s) starting ${staleWindows.join(', ')}.`,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', schedule.id)
                        .eq('next_send_on', schedule.next_send_on)
                    results.skipped.push({ scheduleId: schedule.id, staleWindows })
                }
                continue
            }

            const advanced = computeCursor(group, schedule, advanceWindowStart(group, windowStart))

            // Belt-and-braces on top of the CAS claim below.
            const { data: existingRows } = await supabaseAdmin
                .from('events')
                .select('id')
                .eq('created_by_schedule_id', schedule.id)
                .eq('date_range_start', windowStart)
                .limit(1)

            if (existingRows && existingRows.length > 0) {
                await supabaseAdmin
                    .from('group_schedules')
                    .update({ ...advanced, updated_at: new Date().toISOString() })
                    .eq('id', schedule.id)
                    .eq('next_send_on', schedule.next_send_on)
                results.skipped.push({ scheduleId: schedule.id, alreadyCreated: windowStart })
                continue
            }

            // Claim the occurrence: advance the cursor only if no other
            // invocation has. 0 rows back → someone else owns it.
            const { data: claimedRows, error: claimError } = await supabaseAdmin
                .from('group_schedules')
                .update({
                    ...advanced,
                    last_sent_on: today,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', schedule.id)
                .eq('next_send_on', schedule.next_send_on)
                .select('id')

            if (claimError) {
                results.errors.push(`schedule ${schedule.id} claim: ${claimError.message}`)
                continue
            }
            if (!claimedRows || claimedRows.length === 0) {
                results.skipped.push({ scheduleId: schedule.id, claimedElsewhere: true })
                continue
            }

            const title = buildAutoTitle(group.name, group, windowStart, current.next_window_end)
            const slugResult = await generateUniqueSlug(supabaseAdmin, title)
            let created = slugResult.error ? { error: slugResult.error } : null

            if (!created) {
                const effectiveSend = maxDate(current.next_send_on, today)
                created = await createEventCore(supabaseAdmin, {
                    title,
                    slug: slugResult.slug,
                    dateRangeStart: windowStart,
                    dateRangeEnd: current.next_window_end,
                    responseDeadline: computeDeadline(effectiveSend, schedule.deadline_days, windowStart),
                    blockedDates: buildBlockedDates(windowStart, current.next_window_end, schedule.excluded_weekdays),
                    accessMode: group.access_mode,
                    ownerParticipantId: group.owner_participant_id,
                    group,
                    createdByScheduleId: schedule.id,
                    baseUrl,
                })
            }

            if (created.error) {
                // Best-effort revert so the occurrence retries tomorrow; only
                // if the cursor is still the value we advanced it to.
                await supabaseAdmin
                    .from('group_schedules')
                    .update({
                        next_window_start: schedule.next_window_start,
                        next_window_end: schedule.next_window_end,
                        next_send_on: schedule.next_send_on,
                        last_error: created.error,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', schedule.id)
                    .eq('next_send_on', advanced.next_send_on)
                results.errors.push(`schedule ${schedule.id} create: ${created.error}`)
                continue
            }

            await supabaseAdmin
                .from('group_schedules')
                .update({
                    last_sent_event_id: created.event.id,
                    last_error: staleWindows.length > 0
                        ? `Skipped stale window(s) starting ${staleWindows.join(', ')}.`
                        : null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', schedule.id)

            results.created.push({
                scheduleId: schedule.id,
                eventId: created.event.id,
                slug: created.event.slug,
                emailedCount: created.emailedCount,
            })
        } catch (err) {
            results.errors.push(`schedule ${schedule.id}: ${err?.message || err}`)
        }
    }

    return results
}

async function runPresendNotices(supabaseAdmin, today, baseUrl) {
    const results = { noticed: [], errors: [] }

    const { data: schedules, error } = await supabaseAdmin
        .from('group_schedules')
        .select('*, groups(*)')
        .is('paused_at', null)
        .gt('next_send_on', today)
        .lte('next_send_on', addDaysStr(today, PRESEND_NOTICE_DAYS))

    if (error) {
        results.errors.push(`presend query: ${error.message}`)
        return results
    }

    for (const schedule of schedules || []) {
        try {
            if (schedule.presend_notice_sent_for === schedule.next_send_on) continue
            if (!schedule.groups || !schedule.last_sent_event_id) continue

            const { data: previousEvent } = await supabaseAdmin
                .from('events')
                .select('id, title')
                .eq('id', schedule.last_sent_event_id)
                .maybeSingle()

            let unresolved = false
            if (previousEvent) {
                const { data: rounds } = await supabaseAdmin
                    .from('event_followups')
                    .select('id')
                    .eq('event_id', previousEvent.id)
                    .not('selected_date', 'is', null)
                    .limit(1)
                unresolved = !rounds || rounds.length === 0
            }

            if (unresolved) {
                await sendPresendNoticeEmail({
                    group: schedule.groups,
                    schedule,
                    previousEvent,
                    sendDate: schedule.next_send_on,
                    baseUrl,
                })
                results.noticed.push({ scheduleId: schedule.id, sendDate: schedule.next_send_on })
            }

            // Marked resolved-or-noticed either way — one check per send date.
            await supabaseAdmin
                .from('group_schedules')
                .update({ presend_notice_sent_for: schedule.next_send_on, updated_at: new Date().toISOString() })
                .eq('id', schedule.id)
        } catch (err) {
            results.errors.push(`schedule ${schedule.id} presend: ${err?.message || err}`)
        }
    }

    return results
}

async function runDeadlineSummaries(supabaseAdmin, today, baseUrl) {
    const results = { summarized: [], errors: [] }

    const { data: events, error } = await supabaseAdmin
        .from('events')
        .select('id, title, slug, group_id, response_deadline, created_by_schedule_id, date_range_start, date_range_end, blocked_dates')
        .not('group_id', 'is', null)
        .lt('response_deadline', today)
        .is('owner_summary_sent_at', null)

    if (error) {
        results.errors.push(`deadline query: ${error.message}`)
        return results
    }

    for (const event of events || []) {
        try {
            const { data: group } = await supabaseAdmin
                .from('groups')
                .select('*')
                .eq('id', event.group_id)
                .maybeSingle()
            if (!group) {
                // Orphaned marker: claim so it never re-queries.
                await claimOwnerSummary(supabaseAdmin, event.id)
                continue
            }

            const to = await resolveOwnerNotifyEmail(supabaseAdmin, group)

            const built = await buildOwnerSummary(supabaseAdmin, event)
            if (built.error) {
                results.errors.push(`event ${event.id} summary: ${built.error}`)
                continue
            }

            // Opted-in auto polls get the generation stamp (tomorrow) written
            // atomically with the summary claim, and the warning block in the
            // email below.
            const autoContext = await buildAutoScheduleContext(supabaseAdmin, {
                event,
                group,
                responses: built.responses,
                today,
            })

            // Claim before sending: the all-responded hook shares this marker.
            const { claimed, error: claimError } = await claimOwnerSummary(supabaseAdmin, event.id, {
                autoScheduleOn: autoContext?.autoScheduleOn ?? null,
            })
            if (claimError) {
                results.errors.push(`event ${event.id} claim: ${claimError}`)
                continue
            }
            if (!claimed) continue
            if (!to) continue

            await sendOwnerSummaryEmail({
                group,
                event,
                summary: built.summary,
                reason: 'deadline',
                to,
                baseUrl,
                autoSchedule: autoContext?.email ?? null,
            })
            results.summarized.push({ eventId: event.id, slug: event.slug })
        } catch (err) {
            results.errors.push(`event ${event.id} deadline: ${err?.message || err}`)
        }
    }

    return results
}

// Task 4: create the Google Calendar event for polls stamped by a summary at
// least one full day ago. Terminal outcomes always null the stamp
// (auto_schedule_on) so the event never re-queries; the claim ticket
// (auto_scheduled_at) is set via CAS right before touching Google and only
// cleared for transient failures, so a double-fired cron can never create
// two calendar events.
async function runAutoSchedules(supabaseAdmin, today, baseUrl) {
    const results = { scheduled: [], skipped: [], errors: [] }

    const { data: events, error } = await supabaseAdmin
        .from('events')
        .select('*')
        .not('auto_schedule_on', 'is', null)
        .lte('auto_schedule_on', today)
        .is('auto_scheduled_at', null)

    if (error) {
        results.errors.push(`auto-schedule query: ${error.message}`)
        return results
    }

    const consumeStamp = (eventId) => supabaseAdmin
        .from('events')
        .update({ auto_schedule_on: null })
        .eq('id', eventId)

    const releaseClaim = (eventId) => supabaseAdmin
        .from('events')
        .update({ auto_scheduled_at: null })
        .eq('id', eventId)

    const noteError = (scheduleId, message) => supabaseAdmin
        .from('group_schedules')
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq('id', scheduleId)

    for (const event of events || []) {
        try {
            const { data: schedule } = await supabaseAdmin
                .from('group_schedules')
                .select('*, groups(*)')
                .eq('id', event.created_by_schedule_id)
                .maybeSingle()
            const group = schedule?.groups

            // Config gone or feature turned off since stamping: cancel.
            // paused_at is deliberately NOT checked — every pause path asks
            // the owner about pending generations and cancels via the stamp.
            if (!schedule?.auto_schedule_enabled || !group) {
                await consumeStamp(event.id)
                results.skipped.push({ eventId: event.id, reason: 'auto-scheduling disabled' })
                continue
            }

            // Owner already picked a date by any path (hosting round, manual
            // generate): the poll is resolved, which is the goal. Skip silently.
            const { resolved, error: resolvedError } = await hasResolvedRound(supabaseAdmin, event.id)
            if (resolvedError) {
                results.errors.push(`event ${event.id} resolved-check: ${resolvedError}`)
                continue
            }
            if (resolved) {
                await consumeStamp(event.id)
                results.skipped.push({ eventId: event.id, reason: 'already resolved' })
                continue
            }

            // The CAS ticket: only one invocation gets past this line.
            const { data: claimedRows, error: claimError } = await supabaseAdmin
                .from('events')
                .update({ auto_scheduled_at: new Date().toISOString() })
                .eq('id', event.id)
                .is('auto_scheduled_at', null)
                .select('id')
            if (claimError) {
                results.errors.push(`event ${event.id} claim: ${claimError.message}`)
                continue
            }
            if (!claimedRows || claimedRows.length === 0) {
                results.skipped.push({ eventId: event.id, reason: 'claimed elsewhere' })
                continue
            }

            const to = schedule.notify_email
            const { data: ownershipRow } = await supabaseAdmin
                .from('event_ownerships')
                .select('manage_token')
                .eq('event_id', event.id)
                .maybeSingle()
            const manageLink = ownershipRow?.manage_token
                ? `/events/manage/${ownershipRow.manage_token}`
                : `/events/manage/${event.id}`

            const failTerminally = async (reason, detail) => {
                await consumeStamp(event.id)
                if (to) {
                    await sendAutoScheduleFailedEmail({ group, event, to, baseUrl, reason, detail, manageLink })
                }
                results.skipped.push({ eventId: event.id, reason, detail })
            }

            const [membersResult, responsesResult] = await Promise.all([
                supabaseAdmin
                    .from('group_members')
                    .select('id, participant_id, display_name, invited_email')
                    .eq('group_id', group.id)
                    .is('removed_at', null),
                supabaseAdmin
                    .from('responses')
                    .select('id, participant_id, display_name, response_type, dates, confirmed')
                    .eq('event_id', event.id)
                    .is('deleted_at', null),
            ])
            if (membersResult.error || responsesResult.error) {
                await releaseClaim(event.id)
                results.errors.push(`event ${event.id} load: ${(membersResult.error || responsesResult.error).message}`)
                continue
            }
            const members = membersResult.data || []
            const responses = responsesResult.data || []

            const pick = pickAutoDate(event, responses, today)
            if (!pick) {
                await failTerminally('no_availability')
                continue
            }

            const eventTime = normalizeEventTime(schedule.auto_event_time)
            if (!eventTime || !schedule.auto_event_timezone) {
                await failTerminally('no_availability', 'Auto-scheduling settings are missing a time or timezone — edit them on the group page.')
                continue
            }

            const { data: owner } = await supabaseAdmin
                .from('participants')
                .select('google_refresh_token')
                .eq('id', group.owner_participant_id)
                .maybeSingle()
            if (!owner?.google_refresh_token) {
                await failTerminally('reconnect_google')
                continue
            }

            const exchange = await exchangeRefreshToken(owner.google_refresh_token)
            if (exchange.error) {
                if (exchange.permanent) {
                    await failTerminally('reconnect_google', exchange.error)
                } else {
                    await releaseClaim(event.id)
                    await noteError(schedule.id, `Auto-schedule retrying: ${exchange.error}`)
                    results.errors.push(`event ${event.id} token: ${exchange.error}`)
                }
                continue
            }

            const buckets = computeInviteBuckets({
                members,
                responses,
                scope: schedule.auto_invite_scope,
                selectedDate: pick.date,
            })

            const created = await insertCalendarEvent({
                accessToken: exchange.accessToken,
                summary: event.title,
                description: event.description || '',
                selectedDate: pick.date,
                startTime: eventTime,
                timezone: schedule.auto_event_timezone,
                attendeeEmails: buckets.invited.map((member) => member.invited_email),
            })
            if (created.error) {
                if (created.status === 401 || created.status === 403) {
                    await failTerminally('reconnect_google', created.error)
                } else if (created.permanent) {
                    await failTerminally('no_availability', `Google rejected the event: ${created.error}`)
                } else {
                    await releaseClaim(event.id)
                    await noteError(schedule.id, `Auto-schedule retrying: ${created.error}`)
                    results.errors.push(`event ${event.id} calendar: ${created.error}`)
                }
                continue
            }

            // The calendar event exists — everything past here is best-effort
            // bookkeeping and must never re-arm a retry (that would duplicate
            // the Google event).
            await consumeStamp(event.id)

            const recorded = await recordScheduledDate(supabaseAdmin, {
                eventId: event.id,
                selectedDate: pick.date,
                timezone: schedule.auto_event_timezone,
                calendarEventId: created.eventId,
                calendarPayload: { htmlLink: created.htmlLink, startTime: eventTime },
            })
            if (recorded.error) {
                await noteError(schedule.id, `Calendar event created but date not recorded: ${recorded.error}`)
                results.errors.push(`event ${event.id} record: ${recorded.error}`)
            }

            if (to) {
                await sendAutoScheduledEmail({
                    group,
                    event,
                    to,
                    baseUrl,
                    selectedDate: pick.date,
                    eventTime,
                    timezone: schedule.auto_event_timezone,
                    eventUrl: created.htmlLink,
                    buckets,
                    manageLink,
                })
            }

            results.scheduled.push({
                eventId: event.id,
                slug: event.slug,
                date: pick.date,
                invited: buckets.invited.length,
            })
        } catch (err) {
            results.errors.push(`event ${event.id} auto-schedule: ${err?.message || err}`)
        }
    }

    return results
}

export async function GET(request) {
    const { authorized, isAdmin } = resolveCronAuth(request)
    if (!authorized) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    let today = todayDateString()
    if (isAdmin) {
        const override = new URL(request.url).searchParams.get('date')
        if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) today = override
    }

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

    const autoCreate = await runAutoCreate(supabaseAdmin, today, baseUrl)
    const presend = await runPresendNotices(supabaseAdmin, today, baseUrl)
    const deadlines = await runDeadlineSummaries(supabaseAdmin, today, baseUrl)
    const autoSchedules = await runAutoSchedules(supabaseAdmin, today, baseUrl)

    const errors = [...autoCreate.errors, ...presend.errors, ...deadlines.errors, ...autoSchedules.errors]
    if (errors.length > 0) {
        console.error('[cron/daily] errors:', errors)
    }

    return Response.json({
        today,
        autoCreated: autoCreate.created,
        autoSkipped: autoCreate.skipped,
        presendNotices: presend.noticed,
        deadlineSummaries: deadlines.summarized,
        autoScheduled: autoSchedules.scheduled,
        autoScheduleSkipped: autoSchedules.skipped,
        errors,
    })
}
