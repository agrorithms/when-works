// Daily cron (Vercel Cron → vercel.json). Three idempotent tasks, in order:
//   1. auto-create — group polls whose send date has arrived
//   2. pre-send notice — 3-day heads-up when the previous poll is unresolved
//   3. deadline summary — owner email when a poll's deadline has passed
// Every cursor/marker mutation is a compare-and-set update, so a double-fired
// or retried invocation can never create two polls or send two summaries.
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
import { sendPresendNoticeEmail, sendOwnerSummaryEmail } from '../../../../lib/email'
import {
    buildOwnerSummary,
    resolveOwnerNotifyEmail,
    claimOwnerSummary,
} from '../../../../lib/ownerNotifications'

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
        .select('id, title, slug, group_id, response_deadline')
        .not('group_id', 'is', null)
        .lt('response_deadline', today)
        .is('owner_summary_sent_at', null)

    if (error) {
        results.errors.push(`deadline query: ${error.message}`)
        return results
    }

    for (const event of events || []) {
        try {
            // Claim before sending: the all-responded hook shares this marker.
            const { claimed, error: claimError } = await claimOwnerSummary(supabaseAdmin, event.id)
            if (claimError) {
                results.errors.push(`event ${event.id} claim: ${claimError}`)
                continue
            }
            if (!claimed) continue

            const { data: group } = await supabaseAdmin
                .from('groups')
                .select('*')
                .eq('id', event.group_id)
                .maybeSingle()
            if (!group) continue

            const to = await resolveOwnerNotifyEmail(supabaseAdmin, group)
            if (!to) continue

            const built = await buildOwnerSummary(supabaseAdmin, event)
            if (built.error) {
                results.errors.push(`event ${event.id} summary: ${built.error}`)
                continue
            }

            await sendOwnerSummaryEmail({
                group,
                event,
                summary: built.summary,
                reason: 'deadline',
                to,
                baseUrl,
            })
            results.summarized.push({ eventId: event.id, slug: event.slug })
        } catch (err) {
            results.errors.push(`event ${event.id} deadline: ${err?.message || err}`)
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

    const errors = [...autoCreate.errors, ...presend.errors, ...deadlines.errors]
    if (errors.length > 0) {
        console.error('[cron/daily] errors:', errors)
    }

    return Response.json({
        today,
        autoCreated: autoCreate.created,
        autoSkipped: autoCreate.skipped,
        presendNotices: presend.noticed,
        deadlineSummaries: deadlines.summarized,
        errors,
    })
}
