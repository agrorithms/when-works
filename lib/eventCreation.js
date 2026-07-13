// Server-only event-creation core, shared by the events API route (manual
// creation) and the daily cron (auto-created group polls): event insert →
// ownership insert (rollback-delete on failure) → best-effort member emails.

import crypto from 'crypto'
import { sendGroupEventEmails } from './email'

export function makeManageToken() {
    return crypto.randomBytes(16).toString('hex')
}

const SLUG_MAX_LENGTH = 40

export function slugify(title) {
    return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_MAX_LENGTH)
}

// Cron-only: manual creation keeps its client-supplied slug + "taken" error.
export async function generateUniqueSlug(supabaseAdmin, baseTitle) {
    const base = slugify(baseTitle) || 'group-poll'

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const slug = attempt === 0
            ? base
            : `${base.slice(0, SLUG_MAX_LENGTH - 5)}-${crypto.randomBytes(2).toString('hex')}`

        const { data, error } = await supabaseAdmin
            .from('events')
            .select('id')
            .eq('slug', slug)
            .limit(1)

        if (error) return { error: error.message }
        if (!data || data.length === 0) return { slug }
    }

    return { error: 'Could not generate a unique slug.' }
}

// Returns { event, ownership, emailedCount } or { error, status, code }.
// Group notifications are best-effort: creation never fails because email
// did (lib/email.js no-ops without the RESEND env vars).
export async function createEventCore(supabaseAdmin, {
    title,
    description = null,
    slug,
    dateRangeStart,
    dateRangeEnd,
    responseDeadline,
    blockedDates = [],
    showAvailabilityCounts = false,
    allowPlusOne = false,
    accessMode,
    ownerParticipantId = null,
    group = null,
    createdByScheduleId = null,
    baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000',
}) {
    const { data: eventData, error: eventError } = await supabaseAdmin
        .from('events')
        .insert({
            title,
            description,
            slug,
            date_range_start: dateRangeStart,
            date_range_end: dateRangeEnd,
            response_deadline: responseDeadline,
            blocked_dates: blockedDates,
            show_availability_counts: showAvailabilityCounts,
            allow_plus_one: allowPlusOne,
            // Spreads (not explicit nulls) so ungrouped creation keeps working
            // against a pre-006/007 schema during the deploy window.
            ...(group ? { group_id: group.id } : {}),
            ...(createdByScheduleId ? { created_by_schedule_id: createdByScheduleId } : {}),
        })
        .select()
        .single()

    if (eventError) {
        return {
            error: eventError.code === '23505' ? 'That URL slug is already taken.' : eventError.message,
            status: 400,
            code: eventError.code,
        }
    }

    const ownershipPayload = {
        event_id: eventData.id,
        access_mode: accessMode,
        participant_id: ownerParticipantId,
        manage_token: accessMode === 'link' ? makeManageToken() : null,
    }

    const { data: ownershipData, error: ownershipError } = await supabaseAdmin
        .from('event_ownerships')
        .insert(ownershipPayload)
        .select()
        .single()

    if (ownershipError) {
        await supabaseAdmin.from('events').delete().eq('id', eventData.id)
        return {
            error: ownershipError.message || 'Failed to save event ownership.',
            status: 500,
        }
    }

    let emailedCount = null
    if (group) {
        const { data: memberRows } = await supabaseAdmin
            .from('group_members')
            .select('display_name, invited_email, member_token, removed_at')
            .eq('group_id', group.id)
            .is('removed_at', null)

        const emailResult = await sendGroupEventEmails({
            group,
            event: eventData,
            members: memberRows || [],
            baseUrl,
        })
        emailedCount = emailResult.emailedCount
    }

    return { event: eventData, ownership: ownershipData, emailedCount }
}
