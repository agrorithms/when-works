// Server-only owner-summary plumbing for group polls. One summary email per
// event, whichever fires first: the all-responded hook (respond route) or the
// deadline task (daily cron). events.owner_summary_sent_at is the shared
// marker, always claimed with a compare-and-set update so concurrent
// invocations can never double-send.

import { sendOwnerSummaryEmail } from './email'

// Availability tally + manage link for the owner email.
export async function buildOwnerSummary(supabaseAdmin, event) {
    const [membersResult, responsesResult, ownershipResult] = await Promise.all([
        supabaseAdmin
            .from('group_members')
            .select('id, participant_id')
            .eq('group_id', event.group_id)
            .is('removed_at', null),
        supabaseAdmin
            .from('responses')
            .select('participant_id, response_type, dates, confirmed')
            .eq('event_id', event.id)
            .is('deleted_at', null),
        supabaseAdmin
            .from('event_ownerships')
            .select('manage_token')
            .eq('event_id', event.id)
            .maybeSingle(),
    ])

    const error = membersResult.error || responsesResult.error || ownershipResult.error
    if (error) return { error: error.message }

    const members = membersResult.data || []
    const responses = responsesResult.data || []

    const availabilityByDate = {}
    for (const response of responses) {
        if (response.response_type !== 'available') continue
        for (const date of response.dates || []) {
            availabilityByDate[date] = (availabilityByDate[date] || 0) + 1
        }
    }

    const topDates = Object.entries(availabilityByDate)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => b.count - a.count || (a.date < b.date ? -1 : 1))
        .slice(0, 3)

    const manageToken = ownershipResult.data?.manage_token
    return {
        summary: {
            rosterCount: members.length,
            respondentCount: responses.length,
            confirmedCount: responses.filter((row) => row.confirmed).length,
            topDates,
            manageLink: manageToken ? `/events/manage/${manageToken}` : `/events/manage/${event.id}`,
        },
        members,
        responses,
    }
}

// Notification address: the group's automation setting wins, then the owner
// participant's email, else null (no summary is sent, marker still set).
export async function resolveOwnerNotifyEmail(supabaseAdmin, group) {
    const { data: schedule } = await supabaseAdmin
        .from('group_schedules')
        .select('notify_email')
        .eq('group_id', group.id)
        .maybeSingle()

    if (schedule?.notify_email) return schedule.notify_email

    if (group.owner_participant_id) {
        const { data: owner } = await supabaseAdmin
            .from('participants')
            .select('email')
            .eq('id', group.owner_participant_id)
            .maybeSingle()
        if (owner?.email) return owner.email
    }

    return null
}

// CAS-claims the summary marker; returns false if another invocation (or the
// other trigger) already owns it.
export async function claimOwnerSummary(supabaseAdmin, eventId) {
    const { data, error } = await supabaseAdmin
        .from('events')
        .update({ owner_summary_sent_at: new Date().toISOString() })
        .eq('id', eventId)
        .is('owner_summary_sent_at', null)
        .select('id')

    if (error) return { error: error.message }
    return { claimed: Boolean(data && data.length > 0) }
}

// The all-responded trigger (respond-route hook). `event` needs id, group_id,
// title. Confirmed responses only — the respond page mints an unconfirmed row
// the moment a member opens their link, so mere visits must not count.
export async function maybeSendAllRespondedSummary(supabaseAdmin, event, baseUrl) {
    if (!event.group_id) return { sent: false }

    const built = await buildOwnerSummary(supabaseAdmin, event)
    if (built.error) return { error: built.error }

    const { summary, members, responses } = built
    if (members.length === 0) return { sent: false }

    const confirmedParticipants = new Set(
        responses.filter((row) => row.confirmed).map((row) => row.participant_id)
    )
    const allResponded = members.every((member) => confirmedParticipants.has(member.participant_id))
    if (!allResponded) return { sent: false }

    const { data: group } = await supabaseAdmin
        .from('groups')
        .select('*')
        .eq('id', event.group_id)
        .maybeSingle()
    if (!group) return { sent: false }

    const to = await resolveOwnerNotifyEmail(supabaseAdmin, group)

    const { claimed, error: claimError } = await claimOwnerSummary(supabaseAdmin, event.id)
    if (claimError || !claimed) return { sent: false, error: claimError }

    if (!to) return { sent: false } // marker set: the deadline task won't retry either

    await sendOwnerSummaryEmail({
        group,
        event,
        summary,
        reason: 'all_responded',
        to,
        baseUrl,
    })
    return { sent: true }
}
