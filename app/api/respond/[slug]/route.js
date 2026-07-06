import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getAttendeeWeight } from '../../../../lib/attendance'
import {
    normalizeEmail,
    getParticipantByEmail,
    ensureParticipantForSession,
    getParticipantByToken,
    createGuestParticipant,
    claimResponseForParticipant,
} from '../../../../lib/participants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PUBLIC_EVENT_FIELDS = 'id, title, description, slug, date_range_start, date_range_end, response_deadline, blocked_dates, show_availability_counts, allow_plus_one'
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NAME_LENGTH = 80
// Embeds the owning participant's token so the browser can adopt the
// device-wide identity when it resolves a row via a legacy response_token.
const OWN_RESPONSE_FIELDS = '*, participants(participant_token)'

// The respondent's own row, minus google_email. The two tokens are the
// capabilities that authorize future saves — they are only ever returned
// here, to the browser that owns the session. response_token stays in the
// payload until the post-005 cleanup PR.
function sanitizeOwnResponse(row, participantToken = null) {
    return {
        id: row.id,
        name: row.name,
        display_name: row.display_name,
        response_type: row.response_type,
        dates: row.dates || [],
        confirmed: row.confirmed,
        includes_so: Boolean(row.includes_so),
        response_token: row.response_token,
        participant_token: participantToken || row.participants?.participant_token || null,
    }
}

async function getEventBySlug(supabaseAdmin, slug) {
    const { data, error } = await supabaseAdmin
        .from('events')
        .select(PUBLIC_EVENT_FIELDS)
        .eq('slug', slug)
        .limit(1)

    if (error || !data || data.length === 0) return null
    return data[0]
}

async function getResponseCounts(supabaseAdmin, eventId) {
    const { data } = await supabaseAdmin
        .from('responses')
        .select('includes_so, confirmed')
        .eq('event_id', eventId)
        .is('deleted_at', null)

    const rows = data || []
    return {
        attendeeCount: rows.reduce((sum, row) => sum + getAttendeeWeight(row), 0),
        responseCount: rows.length,
        confirmedCount: rows.filter((row) => row.confirmed).length,
    }
}

async function getOpenRound(supabaseAdmin, eventId) {
    const { data } = await supabaseAdmin
        .from('event_followups')
        .select('id, selected_date')
        .eq('event_id', eventId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)

    return data && data.length > 0 ? data[0] : null
}

async function getActiveResponseByParticipant(supabaseAdmin, eventId, participantId) {
    const { data } = await supabaseAdmin
        .from('responses')
        .select(OWN_RESPONSE_FIELDS)
        .eq('event_id', eventId)
        .eq('participant_id', participantId)
        .is('deleted_at', null)
        .limit(1)

    return data && data.length > 0 ? data[0] : null
}

// Finds the respondent's own ACTIVE row. Signed-in identity always wins over
// device tokens (shared computers), then the device-wide participant_token,
// then the legacy per-event response_token.
async function resolveRespondent(supabaseAdmin, eventId, session, body) {
    const sessionParticipant = session?.user?.email
        ? await getParticipantByEmail(supabaseAdmin, session.user.email)
        : null

    if (sessionParticipant) {
        const response = await getActiveResponseByParticipant(supabaseAdmin, eventId, sessionParticipant.id)
        if (response) return { response, via: 'session', sessionParticipant, deviceParticipant: null }
    }

    const deviceParticipant = await getParticipantByToken(supabaseAdmin, body.participantToken)

    if (deviceParticipant) {
        const response = await getActiveResponseByParticipant(supabaseAdmin, eventId, deviceParticipant.id)
        if (response) return { response, via: 'participant_token', sessionParticipant, deviceParticipant }
    }

    if (typeof body.responseToken === 'string' && UUID_PATTERN.test(body.responseToken)) {
        const { data } = await supabaseAdmin
            .from('responses')
            .select(OWN_RESPONSE_FIELDS)
            .eq('event_id', eventId)
            .eq('response_token', body.responseToken)
            .is('deleted_at', null)
            .limit(1)

        if (data && data.length > 0) {
            return { response: data[0], via: 'response_token', sessionParticipant, deviceParticipant }
        }
    }

    return { response: null, via: null, sessionParticipant, deviceParticipant }
}

// Claim rules, applied after resolution:
//   - Signed-in + token-resolved row → repoint participant_id to the email
//     participant (safe: session resolution already proved that participant
//     has no active row on this event).
//   - Guest + legacy-token-resolved row with null participant_id → attach the
//     device participant.
// Participants are only CREATED here when allowCreate is set (the `start`
// action); save/hosting_info claim with existing participants only.
// Returns { response, participantToken } — the token the browser should
// store as its device-wide identity.
async function applyClaims(supabaseAdmin, resolved, session, { allowCreate = false } = {}) {
    const { via, sessionParticipant, deviceParticipant } = resolved
    let response = resolved.response

    if (!response) return { response: null, participantToken: null }

    if (via === 'session') {
        return { response, participantToken: sessionParticipant.participant_token }
    }

    if (session?.user?.email) {
        const emailParticipant = sessionParticipant
            || (allowCreate ? await ensureParticipantForSession(supabaseAdmin, session) : null)

        if (emailParticipant && response.participant_id !== emailParticipant.id) {
            response = await claimResponseForParticipant(supabaseAdmin, response, emailParticipant.id)
        }

        if (emailParticipant) {
            return { response, participantToken: emailParticipant.participant_token }
        }
        // No participant yet (fire-and-forget signIn upsert failed and this
        // isn't `start`): fall through to the token identities below.
    }

    if (via === 'participant_token') {
        return { response, participantToken: deviceParticipant.participant_token }
    }

    // Legacy response_token hit. If the row already belongs to a participant,
    // hand that participant's token back so this device adopts it.
    if (response.participant_id) {
        return { response, participantToken: response.participants?.participant_token || null }
    }

    const adopter = deviceParticipant
        || (allowCreate ? await createGuestParticipant(supabaseAdmin) : null)

    if (adopter) {
        response = await claimResponseForParticipant(supabaseAdmin, response, adopter.id)
        return { response, participantToken: adopter.participant_token }
    }

    return { response, participantToken: null }
}

// Deleted rows deliberately count here: restoring one must not collide with a
// reissued "Guest #N".
async function getNextGuestNumber(supabaseAdmin, eventId) {
    const { data } = await supabaseAdmin
        .from('responses')
        .select('display_name')
        .eq('event_id', eventId)
        .like('display_name', 'Guest %')

    if (!data) return 1

    const guestNumbers = data
        .map((row) => {
            const match = row.display_name.match(/Guest #(\d+)/)
            return match ? parseInt(match[1]) : 0
        })
        .filter((n) => n > 0)

    return guestNumbers.length > 0 ? Math.max(...guestNumbers) + 1 : 1
}

function sanitizeDates(rawDates, event) {
    if (!Array.isArray(rawDates)) return null

    const blocked = event.blocked_dates || []
    const valid = rawDates.filter((date) =>
        typeof date === 'string' &&
        ISO_DATE_PATTERN.test(date) &&
        date >= event.date_range_start &&
        date <= event.date_range_end &&
        !blocked.includes(date)
    )

    return [...new Set(valid)].sort()
}

export async function GET(_request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const slug = params?.slug

    if (!slug || typeof slug !== 'string') {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const event = await getEventBySlug(supabaseAdmin, slug)
    if (!event) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const [counts, openRound] = await Promise.all([
        getResponseCounts(supabaseAdmin, event.id),
        getOpenRound(supabaseAdmin, event.id),
    ])

    let confirmedResponses = []
    if (event.show_availability_counts) {
        const { data } = await supabaseAdmin
            .from('responses')
            .select('id, response_type, dates, includes_so')
            .eq('event_id', event.id)
            .eq('confirmed', true)
            .is('deleted_at', null)
        confirmedResponses = data || []
    }

    return Response.json({
        event,
        attendeeCount: counts.attendeeCount,
        responseCount: counts.responseCount,
        confirmedCount: counts.confirmedCount,
        confirmedResponses,
        openRound: openRound ? { selected_date: openRound.selected_date } : null,
    })
}

export async function POST(request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const slug = params?.slug

    if (!slug || typeof slug !== 'string') {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const event = await getEventBySlug(supabaseAdmin, slug)
    if (!event) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const session = await getServerSession(authOptions)

    if (body.action === 'start') {
        const resolved = await resolveRespondent(supabaseAdmin, event.id, session, body)

        if (resolved.response) {
            const claimed = await applyClaims(supabaseAdmin, resolved, session, { allowCreate: true })
            let existing = claimed.response

            // Legacy dual-write: stamp the (normalized) session email onto
            // rows that predate it. Removed in the post-005 cleanup PR.
            if (session?.user?.email && !existing.google_email) {
                const email = normalizeEmail(session.user.email)
                await supabaseAdmin
                    .from('responses')
                    .update({ google_email: email })
                    .eq('id', existing.id)
                existing = { ...existing, google_email: email }
            }

            return Response.json({
                response: sanitizeOwnResponse(existing, claimed.participantToken),
                created: false,
            })
        }

        // Returning-visitor probe (page load): report "nothing here" instead
        // of creating a row — otherwise every guest with a device-wide token
        // would mint an empty response just by viewing an event.
        if (body.resolveOnly) {
            return Response.json({ response: null, created: false })
        }

        // No existing row: pin down who this response will belong to.
        let participant = null
        if (session?.user?.email) {
            participant = resolved.sessionParticipant || await ensureParticipantForSession(supabaseAdmin, session)
        } else {
            participant = resolved.deviceParticipant || await createGuestParticipant(supabaseAdmin)
        }

        const trimmedName = typeof body.name === 'string'
            ? body.name.trim().slice(0, MAX_NAME_LENGTH)
            : ''

        let displayName = trimmedName
        let internalName = trimmedName ? trimmedName.toLowerCase() : null

        if (!trimmedName) {
            const guestNumber = await getNextGuestNumber(supabaseAdmin, event.id)
            displayName = `Guest #${guestNumber}`
            internalName = `guest_${guestNumber}`
        }

        const { data: inserted, error: insertError } = await supabaseAdmin
            .from('responses')
            .insert({
                name: internalName,
                display_name: displayName,
                includes_so: Boolean(body.includesSO),
                response_type: 'available',
                dates: [],
                confirmed: false,
                event_id: event.id,
                participant_id: participant?.id ?? null,
                google_email: normalizeEmail(session?.user?.email),
            })
            .select('*')
            .single()

        if (insertError || !inserted) {
            // Unique-index rejection: a concurrent `start` from the same
            // participant won the race — return that row instead.
            if (insertError?.code === '23505' && participant) {
                const raced = await getActiveResponseByParticipant(supabaseAdmin, event.id, participant.id)
                if (raced) {
                    return Response.json({
                        response: sanitizeOwnResponse(raced, participant.participant_token),
                        created: false,
                    })
                }
            }
            return Response.json({ error: 'Could not start a response session.' }, { status: 500 })
        }

        return Response.json({
            response: sanitizeOwnResponse(inserted, participant?.participant_token ?? null),
            created: true,
        })
    }

    if (body.action === 'save') {
        const resolved = await resolveRespondent(supabaseAdmin, event.id, session, body)

        if (!resolved.response) {
            return Response.json({ error: 'Response session not found.' }, { status: 404 })
        }

        const claimed = await applyClaims(supabaseAdmin, resolved, session)
        const existing = claimed.response

        const updates = {}

        if ('response_type' in body) {
            if (!['available', 'unavailable'].includes(body.response_type)) {
                return Response.json({ error: 'Invalid response type.' }, { status: 400 })
            }
            updates.response_type = body.response_type
        }

        if ('dates' in body) {
            const dates = sanitizeDates(body.dates, event)
            if (dates === null) {
                return Response.json({ error: 'Invalid dates.' }, { status: 400 })
            }
            updates.dates = dates
        }

        if ('confirmed' in body) {
            updates.confirmed = Boolean(body.confirmed)
        }

        if ('includes_so' in body) {
            updates.includes_so = Boolean(body.includes_so)
        }

        if ('name' in body) {
            const trimmedName = typeof body.name === 'string'
                ? body.name.trim().slice(0, MAX_NAME_LENGTH)
                : ''
            if (trimmedName) {
                updates.display_name = trimmedName
                updates.name = trimmedName.toLowerCase()
            }
        }

        if (session?.user?.email && !existing.google_email) {
            updates.google_email = normalizeEmail(session.user.email)
        }

        if (Object.keys(updates).length === 0) {
            return Response.json({ response: sanitizeOwnResponse(existing, claimed.participantToken) })
        }

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('responses')
            .update(updates)
            .eq('id', existing.id)
            .select('*')
            .single()

        if (updateError || !updated) {
            return Response.json({ error: 'Could not save your response.' }, { status: 500 })
        }

        return Response.json({ response: sanitizeOwnResponse(updated, claimed.participantToken) })
    }

    if (body.action === 'hosting_info') {
        const resolved = await resolveRespondent(supabaseAdmin, event.id, session, body)
        const existing = resolved.response

        if (!existing) {
            return Response.json({ error: 'Response session not found.' }, { status: 404 })
        }

        const round = await getOpenRound(supabaseAdmin, event.id)
        if (!round) {
            return Response.json({ round: null })
        }

        const { data: inviteRows } = await supabaseAdmin
            .from('event_followup_invites')
            .select('invite_token')
            .eq('followup_id', round.id)
            .eq('response_id', existing.id)
            .limit(1)

        if (!inviteRows || inviteRows.length === 0) {
            return Response.json({ round: null })
        }

        return Response.json({
            round: { selected_date: round.selected_date },
            inviteToken: inviteRows[0].invite_token,
        })
    }

    return Response.json({ error: 'Unsupported action.' }, { status: 400 })
}
