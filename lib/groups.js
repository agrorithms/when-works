// Server-only helpers for groups: access resolution (mirrors lib/ownership),
// roster management, and the owner bundle (members + linked events +
// computed attendance/scores).

import { isAdminRequest } from './adminAuth'
import { getParticipantByEmail, createGuestParticipant, normalizeEmail } from './participants'
import { computeGroupAttendance, computeCadenceNudge } from './groupAttendance'

const MAX_NAME_LENGTH = 80

// Explicit column lists: participants(email) is joined only to compute
// has_email, then stripped. member_token IS owner-visible — it's how the host
// copies per-member links (possession = respond-as-member; accepted threat
// model). participants.email and participant_token never leave the server.
const MEMBER_COLUMNS = 'id, group_id, participant_id, display_name, invited_email, member_token, removed_at, created_at, participants(email)'
const GROUP_RESPONSE_COLUMNS = 'id, event_id, participant_id, display_name, confirmed, response_type, dates'

function canBeUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)
}

export function todayDateString() {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
}

export function sanitizeGroup(group) {
    return {
        id: group.id,
        name: group.name,
        cadence_unit: group.cadence_unit,
        cadence_interval: group.cadence_interval,
        cadence_anchor_day: group.cadence_anchor_day,
        access_mode: group.access_mode,
        created_at: group.created_at,
        manageLink: group.manage_token ? `/groups/manage/${group.manage_token}` : `/groups/manage/${group.id}`,
    }
}

// Owner-visible schedule fields. pause_token stays server-side — it's a
// mutation capability mailed in notices, not something the UI needs.
export function sanitizeSchedule(schedule) {
    if (!schedule) return null
    return {
        id: schedule.id,
        excluded_weekdays: schedule.excluded_weekdays || [],
        send_day_of_month: schedule.send_day_of_month,
        lead_days: schedule.lead_days,
        deadline_days: schedule.deadline_days,
        notify_email: schedule.notify_email,
        paused_at: schedule.paused_at,
        next_window_start: schedule.next_window_start,
        next_window_end: schedule.next_window_end,
        next_send_on: schedule.next_send_on,
        last_sent_on: schedule.last_sent_on,
        last_error: schedule.last_error,
    }
}

export async function getGroupSchedule(supabaseAdmin, groupId) {
    const { data, error } = await supabaseAdmin
        .from('group_schedules')
        .select('*')
        .eq('group_id', groupId)
        .maybeSingle()
    if (error) return { error: error.message, status: 500 }
    return { schedule: data || null }
}

export function sanitizeMember(row) {
    return {
        id: row.id,
        display_name: row.display_name,
        invited_email: row.invited_email,
        member_token: row.member_token,
        removed_at: row.removed_at,
        created_at: row.created_at,
        has_email: Boolean(row.participants?.email),
    }
}

// Resolves a groups row from `ref`, which is either a group id (Google
// session or admin access) or a manage_token (private link). Same path order
// as resolveOwnership: admin header, then session owner match, then token.
// 32-hex manage tokens parse as UUIDs and safely no-match on id lookups.
export async function resolveGroupAccess(supabaseAdmin, ref, session, request = null) {
    if (request && canBeUuid(ref) && isAdminRequest(request)) {
        const { data: adminRows, error: adminError } = await supabaseAdmin
            .from('groups')
            .select('*')
            .eq('id', ref)
            .limit(1)

        if (adminError) {
            return { error: adminError.message, status: 500 }
        }

        if (adminRows && adminRows.length > 0) {
            return { group: adminRows[0] }
        }
        // Fall through: ref may still be a manage_token.
    }

    if (session?.user?.email && canBeUuid(ref)) {
        const { data: groupRows, error: groupError } = await supabaseAdmin
            .from('groups')
            .select('*')
            .eq('id', ref)
            .limit(1)

        if (groupError) {
            return { error: groupError.message, status: 500 }
        }

        if (groupRows && groupRows.length > 0) {
            const group = groupRows[0]
            const participant = await getParticipantByEmail(supabaseAdmin, session.user.email)

            if (!participant || group.owner_participant_id !== participant.id) {
                return { error: 'Forbidden', status: 403 }
            }

            return { group }
        }
    }

    const { data: tokenRows, error: tokenError } = await supabaseAdmin
        .from('groups')
        .select('*')
        .eq('manage_token', ref)
        .limit(1)

    if (tokenError) {
        return { error: tokenError.message, status: 500 }
    }

    if (!tokenRows || tokenRows.length === 0) {
        return { error: 'Group link not found.', status: 404 }
    }

    return { group: tokenRows[0] }
}

// Resolve-or-create the participant behind a new member, then insert the
// membership. Email members converge with later Google sign-ins because
// participants.email is the upsert conflict key everywhere.
export async function addMemberToGroup(supabaseAdmin, group, { displayName, email }) {
    const name = (displayName || '').trim().slice(0, MAX_NAME_LENGTH)
    if (!name) {
        return { error: 'Member name is required.', status: 400 }
    }

    const normalized = normalizeEmail(email)
    let participant = null

    if (normalized) {
        const { data, error } = await supabaseAdmin
            .from('participants')
            .upsert({ email: normalized }, { onConflict: 'email', ignoreDuplicates: false })
            .select('*')
            .single()

        if (error || !data) {
            return { error: 'Could not resolve that email to a person.', status: 500 }
        }
        participant = data
    } else {
        participant = await createGuestParticipant(supabaseAdmin)
        if (!participant) {
            return { error: 'Could not create the member.', status: 500 }
        }
    }

    const { data: existingRows } = await supabaseAdmin
        .from('group_members')
        .select('id, display_name')
        .eq('group_id', group.id)
        .eq('participant_id', participant.id)
        .is('removed_at', null)
        .limit(1)

    if (existingRows && existingRows.length > 0) {
        return {
            error: `"${existingRows[0].display_name}" is already in this group with that email.`,
            status: 409,
        }
    }

    const { data: member, error: memberError } = await supabaseAdmin
        .from('group_members')
        .insert({
            group_id: group.id,
            participant_id: participant.id,
            display_name: name,
            invited_email: normalized,
        })
        .select(MEMBER_COLUMNS)
        .single()

    if (memberError || !member) {
        if (memberError?.code === '23505') {
            return { error: 'That person is already in this group.', status: 409 }
        }
        return { error: memberError?.message || 'Could not add the member.', status: 500 }
    }

    return { member }
}

// The owner bundle: group + active members (with computed scores) + linked
// events (with per-member attendance) + the cadence nudge.
export async function loadGroupBundle(supabaseAdmin, group) {
    const { data: memberRows, error: membersError } = await supabaseAdmin
        .from('group_members')
        .select(MEMBER_COLUMNS)
        .eq('group_id', group.id)
        .is('removed_at', null)
        .order('created_at', { ascending: true })

    if (membersError) {
        return { error: membersError.message, status: 500 }
    }

    const members = memberRows || []

    const { data: eventRows, error: eventsError } = await supabaseAdmin
        .from('events')
        .select('id, title, slug, date_range_start, date_range_end, response_deadline, created_at')
        .eq('group_id', group.id)
        .order('created_at', { ascending: false })

    if (eventsError) {
        return { error: eventsError.message, status: 500 }
    }

    const scheduleResult = await getGroupSchedule(supabaseAdmin, group.id)
    if (scheduleResult.error) {
        return { error: scheduleResult.error, status: 500 }
    }

    const events = eventRows || []
    const eventIds = events.map((event) => event.id)

    let responses = []
    let rounds = []
    let attendanceRows = []
    let invites = []
    let answers = []

    if (eventIds.length > 0) {
        const [responsesResult, roundsResult, attendanceResult] = await Promise.all([
            supabaseAdmin
                .from('responses')
                .select(GROUP_RESPONSE_COLUMNS)
                .in('event_id', eventIds)
                .is('deleted_at', null),
            supabaseAdmin
                .from('event_followups')
                .select('id, event_id, selected_date, created_at')
                .in('event_id', eventIds)
                .order('created_at', { ascending: false }),
            supabaseAdmin
                .from('group_event_attendance')
                .select('event_id, member_id, attended_override, linked_response_id')
                .eq('group_id', group.id),
        ])

        const firstError = responsesResult.error || roundsResult.error || attendanceResult.error
        if (firstError) {
            return { error: firstError.message, status: 500 }
        }

        responses = responsesResult.data || []
        rounds = roundsResult.data || []
        attendanceRows = attendanceResult.data || []
    }

    // Latest round WITH a selected_date per event (rounds are already
    // created_at desc).
    const roundByEvent = {}
    for (const round of rounds) {
        if (round.selected_date && !roundByEvent[round.event_id]) {
            roundByEvent[round.event_id] = round
        }
    }

    const roundIds = Object.values(roundByEvent).map((round) => round.id)
    if (roundIds.length > 0) {
        const [invitesResult, answersResult] = await Promise.all([
            supabaseAdmin
                .from('event_followup_invites')
                .select('id, followup_id, response_id')
                .in('followup_id', roundIds),
            supabaseAdmin
                .from('event_followup_answers')
                .select('invite_id, followup_id, still_available')
                .in('followup_id', roundIds),
        ])

        const followupError = invitesResult.error || answersResult.error
        if (followupError) {
            return { error: followupError.message, status: 500 }
        }

        invites = invitesResult.data || []
        answers = answersResult.data || []
    }

    const inviteById = {}
    for (const invite of invites) {
        inviteById[invite.id] = invite
    }

    const stillAvailableByRoundResponse = {}
    for (const answer of answers) {
        const invite = inviteById[answer.invite_id]
        if (invite?.response_id) {
            stillAvailableByRoundResponse[`${answer.followup_id}:${invite.response_id}`] = answer.still_available
        }
    }

    const responsesByEvent = {}
    for (const response of responses) {
        if (!responsesByEvent[response.event_id]) responsesByEvent[response.event_id] = []
        responsesByEvent[response.event_id].push(response)
    }

    const today = todayDateString()
    const eventsWithRound = events
        .filter((event) => roundByEvent[event.id] && roundByEvent[event.id].selected_date <= today)
        .map((event) => ({ event, round: roundByEvent[event.id] }))

    const { perMember } = computeGroupAttendance({
        members,
        eventsWithRound,
        responsesByEvent,
        attendanceRows,
        stillAvailableByRoundResponse,
    })

    const nudge = computeCadenceNudge(group, eventsWithRound)

    const countableEventIds = new Set(eventsWithRound.map(({ event }) => event.id))

    return {
        group: sanitizeGroup(group),
        members: members.map((row) => ({
            ...sanitizeMember(row),
            score: Math.round((perMember[row.id]?.score || 0) * 100) / 100,
            attendedCount: perMember[row.id]?.count || 0,
        })),
        events: events.map((event) => ({
            id: event.id,
            title: event.title,
            slug: event.slug,
            response_deadline: event.response_deadline,
            created_at: event.created_at,
            selected_date: roundByEvent[event.id]?.selected_date || null,
            countable: countableEventIds.has(event.id),
            responses: (responsesByEvent[event.id] || []).map((response) => ({
                id: response.id,
                display_name: response.display_name,
                confirmed: response.confirmed,
            })),
            attendance: Object.fromEntries(
                members.map((member) => [member.id, perMember[member.id]?.perEvent?.[event.id] || null])
            ),
        })),
        nudge,
        schedule: sanitizeSchedule(scheduleResult.schedule),
    }
}
