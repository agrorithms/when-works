import crypto from 'crypto'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../lib/auth'
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin'
import {
    normalizeEmail,
    getParticipantByEmail,
    ensureParticipantForSession,
    getParticipantByToken,
} from '../../../lib/participants'
import { resolveGroupAccess, sanitizeSchedule, todayDateString } from '../../../lib/groups'
import { createEventCore } from '../../../lib/eventCreation'
import { validateScheduleConfig, computeFirstWindow } from '../../../lib/schedule'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function getOwnedEventsForSession(session) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        throw new Error('Missing Supabase server configuration.')
    }

    const email = normalizeEmail(session.user.email)
    const participant = await getParticipantByEmail(supabaseAdmin, email)
    if (!participant) return []

    const { data: participantRows, error: participantError } = await supabaseAdmin
        .from('event_ownerships')
        .select('*')
        .eq('participant_id', participant.id)

    if (participantError) {
        throw participantError
    }

    const rows = participantRows || []

    const eventIds = [...new Set(rows.map((row) => row.event_id))]
    if (eventIds.length === 0) return []

    const { data: events, error: eventsError } = await supabaseAdmin
        .from('events')
        .select('*')
        .in('id', eventIds)
        .order('created_at', { ascending: false })

    if (eventsError) {
        throw eventsError
    }

    const { data: responses, error: responsesError } = await supabaseAdmin
        .from('responses')
        .select('id, event_id, confirmed, includes_so')
        .in('event_id', eventIds)
        .is('deleted_at', null)

    if (responsesError) {
        throw responsesError
    }

    const responsesByEvent = (responses || []).reduce((acc, response) => {
        if (!acc[response.event_id]) acc[response.event_id] = []
        acc[response.event_id].push(response)
        return acc
    }, {})

    const ownershipByEvent = rows.reduce((acc, row) => {
        acc[row.event_id] = row
        return acc
    }, {})

    return (events || []).map((event) => {
        const eventResponses = responsesByEvent[event.id] || []
        const ownership = ownershipByEvent[event.id] || null

        return {
            ...event,
            ownership,
            responseCount: eventResponses.length,
            confirmedCount: eventResponses.filter((response) => response.confirmed).length,
            publicLink: `/respond/${event.slug}`,
            manageLink: ownership?.manage_token ? `/events/manage/${ownership.manage_token}` : `/events/manage/${event.id}`,
        }
    })
}

export async function GET() {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const events = await getOwnedEventsForSession(session)
        return Response.json({ events })
    } catch (error) {
        return Response.json(
            { error: error?.message || 'Failed to load events' },
            { status: 500 }
        )
    }
}

export async function POST(request) {
    const session = await getServerSession(authOptions)
    const supabaseAdmin = getSupabaseAdmin()

    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const body = await request.json()

    const title = (body.title || '').trim()
    const description = (body.description || '').trim() || null
    const slug = (body.slug || '').trim()
    const dateRangeStart = body.date_range_start
    const dateRangeEnd = body.date_range_end
    const responseDeadline = body.response_deadline
    const blockedDates = Array.isArray(body.blocked_dates) ? body.blocked_dates : []
    const showAvailabilityCounts = Boolean(body.show_availability_counts)
    const allowPlusOne = Boolean(body.allow_plus_one)
    const accessMode = body.access_mode

    if (!title || !slug || !dateRangeStart || !dateRangeEnd || !responseDeadline || !accessMode) {
        return Response.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    if (!['google', 'link'].includes(accessMode)) {
        return Response.json({ error: 'Invalid access mode.' }, { status: 400 })
    }

    if (accessMode === 'google' && !session?.user?.id) {
        return Response.json({ error: 'Please sign in with Google to create an event this way.' }, { status: 401 })
    }

    let participant = null
    if (accessMode === 'google') {
        participant = await ensureParticipantForSession(supabaseAdmin, session)
    } else if (body.participantToken) {
        participant = await getParticipantByToken(supabaseAdmin, body.participantToken)
    }

    // Linking to a group requires proving group access — 403 aborts creation.
    let group = null
    if (body.groupRef) {
        const groupResult = await resolveGroupAccess(supabaseAdmin, body.groupRef, session, request)
        if (!groupResult.group) {
            return Response.json(
                { error: groupResult.error || 'Group not found.' },
                { status: groupResult.status || 404 }
            )
        }
        group = groupResult.group
    }

    // Automation config is validated BEFORE the event insert so a bad
    // schedule payload fails clean (no orphaned event).
    let scheduleConfig = null
    if (group && body.schedule) {
        const configResult = validateScheduleConfig(group, {
            excluded_weekdays: body.schedule.excluded_weekdays,
            send_day_of_month: body.schedule.send_day_of_month ?? null,
            lead_days: body.schedule.lead_days ?? null,
            deadline_days: body.schedule.deadline_days,
            notify_email: body.schedule.notify_email,
        })
        if (configResult.error) {
            return Response.json({ error: configResult.error }, { status: 400 })
        }
        scheduleConfig = configResult.config
    }

    const created = await createEventCore(supabaseAdmin, {
        title,
        description,
        slug,
        dateRangeStart,
        dateRangeEnd,
        responseDeadline,
        blockedDates,
        showAvailabilityCounts,
        allowPlusOne,
        accessMode,
        ownerParticipantId: participant?.id ?? null,
        group,
    })

    if (created.error) {
        return Response.json({ error: created.error }, { status: created.status || 500 })
    }

    const { event: eventData, ownership: ownershipData, emailedCount } = created

    // The event just created anchors the schedule: it covers the current
    // period, so the first auto poll targets the following one.
    let schedule = null
    let scheduleError = null
    if (scheduleConfig) {
        const cursor = computeFirstWindow(group, scheduleConfig, {
            anchorEvent: eventData,
            today: todayDateString(),
        })
        const { data: scheduleRow, error: upsertError } = await supabaseAdmin
            .from('group_schedules')
            .upsert(
                {
                    group_id: group.id,
                    ...scheduleConfig,
                    ...cursor,
                    pause_token: crypto.randomBytes(16).toString('hex'),
                    paused_at: null,
                    presend_notice_sent_for: null,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'group_id' }
            )
            .select('*')
            .single()

        if (upsertError || !scheduleRow) {
            scheduleError = 'The event was created, but automatic polls could not be saved.'
        } else {
            schedule = sanitizeSchedule(scheduleRow)
        }
    }

    return Response.json({
        event: {
            ...eventData,
            ownership: ownershipData,
            publicLink: `/respond/${eventData.slug}`,
            manageLink: ownershipData.manage_token ? `/events/manage/${ownershipData.manage_token}` : `/events/manage/${eventData.id}`,
        },
        ...(group ? { emailedCount } : {}),
        ...(schedule ? { schedule } : {}),
        ...(scheduleError ? { scheduleError } : {}),
    })
}
