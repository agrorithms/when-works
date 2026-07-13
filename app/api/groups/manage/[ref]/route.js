import crypto from 'crypto'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin'
import {
    resolveGroupAccess,
    addMemberToGroup,
    loadGroupBundle,
    sanitizeGroup,
    sanitizeMember,
    sanitizeSchedule,
    getGroupSchedule,
    todayDateString,
} from '../../../../../lib/groups'
import { normalizeEmail } from '../../../../../lib/participants'
import {
    validateCadence,
    validateScheduleConfig,
    computeFirstWindow,
    computeCursor,
} from '../../../../../lib/schedule'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The latest linked event anchors the schedule cursor: it covers the current
// period, so the first auto window is the following one.
async function getLatestGroupEvent(supabaseAdmin, groupId) {
    const { data } = await supabaseAdmin
        .from('events')
        .select('id, date_range_start, date_range_end')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(1)
    return data && data.length > 0 ? data[0] : null
}

async function resolveAccess(request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return { failure: Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 }) }
    }

    const params = await context.params
    const ref = params?.ref

    if (!ref || typeof ref !== 'string') {
        return { failure: Response.json({ error: 'Group link not found.' }, { status: 404 }) }
    }

    const session = await getServerSession(authOptions)
    const { group, error, status } = await resolveGroupAccess(supabaseAdmin, ref, session, request)

    if (!group) {
        return { failure: Response.json({ error: error || 'Group link not found.' }, { status: status || 404 }) }
    }

    return { supabaseAdmin, group }
}

async function getActiveMember(supabaseAdmin, group, memberId) {
    if (!memberId) return null

    const { data } = await supabaseAdmin
        .from('group_members')
        .select('*')
        .eq('id', memberId)
        .eq('group_id', group.id)
        .is('removed_at', null)
        .limit(1)

    return data && data.length > 0 ? data[0] : null
}

async function getGroupEvent(supabaseAdmin, group, eventId) {
    if (!eventId) return null

    const { data } = await supabaseAdmin
        .from('events')
        .select('id, group_id')
        .eq('id', eventId)
        .eq('group_id', group.id)
        .limit(1)

    return data && data.length > 0 ? data[0] : null
}

export async function GET(request, context) {
    const { failure, supabaseAdmin, group } = await resolveAccess(request, context)
    if (failure) return failure

    const bundle = await loadGroupBundle(supabaseAdmin, group)
    if (bundle.error) {
        return Response.json({ error: bundle.error }, { status: bundle.status || 500 })
    }

    return Response.json(bundle)
}

export async function POST(request, context) {
    const { failure, supabaseAdmin, group } = await resolveAccess(request, context)
    if (failure) return failure

    const body = await request.json().catch(() => ({}))

    if (body.action === 'update_group') {
        const updates = {}
        let cadenceChanged = false

        if (body.name !== undefined) {
            const name = (body.name || '').trim().slice(0, 80)
            if (!name) {
                return Response.json({ error: 'Group name is required.' }, { status: 400 })
            }
            updates.name = name
        }

        if (body.cadence !== undefined) {
            const cadenceResult = validateCadence(body.cadence)
            if (cadenceResult.error) {
                return Response.json({ error: cadenceResult.error }, { status: 400 })
            }
            const cadence = cadenceResult.cadence
            updates.cadence_unit = cadence?.unit ?? null
            updates.cadence_interval = cadence?.interval ?? null
            updates.cadence_anchor_day = cadence?.anchor_day ?? null
            cadenceChanged = updates.cadence_unit !== group.cadence_unit
                || updates.cadence_interval !== group.cadence_interval
                || updates.cadence_anchor_day !== group.cadence_anchor_day
        }

        if (Object.keys(updates).length === 0) {
            return Response.json({ error: 'Nothing to update.' }, { status: 400 })
        }

        // A cadence change re-anchors any active schedule; the schedule
        // config must still fit the new cadence or the change is rejected
        // (the owner edits/pauses automatic polls first).
        let rescheduled = null
        if (cadenceChanged) {
            const { schedule, error: scheduleError } = await getGroupSchedule(supabaseAdmin, group.id)
            if (scheduleError) {
                return Response.json({ error: scheduleError }, { status: 500 })
            }

            if (schedule && !schedule.paused_at) {
                const nextGroup = { ...group, ...updates }
                if (!nextGroup.cadence_unit) {
                    return Response.json({ error: 'Pause automatic polls before removing the cadence.' }, { status: 400 })
                }
                const configResult = validateScheduleConfig(nextGroup, schedule)
                if (configResult.error) {
                    return Response.json({ error: `Automatic polls don't fit this cadence: ${configResult.error} Edit the automatic-poll settings first.` }, { status: 400 })
                }
                rescheduled = {
                    id: schedule.id,
                    ...computeFirstWindow(nextGroup, configResult.config, {
                        anchorEvent: await getLatestGroupEvent(supabaseAdmin, group.id),
                        today: todayDateString(),
                    }),
                }
            }
        }

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('groups')
            .update(updates)
            .eq('id', group.id)
            .select('*')
            .single()

        if (updateError || !updated) {
            return Response.json({ error: 'Could not update the group.' }, { status: 500 })
        }

        if (rescheduled) {
            const { id: scheduleId, ...cursor } = rescheduled
            await supabaseAdmin
                .from('group_schedules')
                .update({ ...cursor, presend_notice_sent_for: null, updated_at: new Date().toISOString() })
                .eq('id', scheduleId)
        }

        return Response.json({ group: sanitizeGroup(updated) })
    }

    if (body.action === 'update_schedule') {
        const configResult = validateScheduleConfig(group, {
            excluded_weekdays: body.excluded_weekdays,
            send_day_of_month: body.send_day_of_month ?? null,
            lead_days: body.lead_days ?? null,
            deadline_days: body.deadline_days,
            notify_email: body.notify_email,
        })
        if (configResult.error) {
            return Response.json({ error: configResult.error }, { status: 400 })
        }
        const config = configResult.config

        const { schedule: existing, error: scheduleError } = await getGroupSchedule(supabaseAdmin, group.id)
        if (scheduleError) {
            return Response.json({ error: scheduleError }, { status: 500 })
        }

        if (!existing) {
            const cursor = computeFirstWindow(group, config, {
                anchorEvent: await getLatestGroupEvent(supabaseAdmin, group.id),
                today: todayDateString(),
            })
            const { data: created, error: createError } = await supabaseAdmin
                .from('group_schedules')
                .insert({
                    group_id: group.id,
                    ...config,
                    ...cursor,
                    pause_token: crypto.randomBytes(16).toString('hex'),
                })
                .select('*')
                .single()

            if (createError || !created) {
                return Response.json({ error: 'Could not save automatic-poll settings.' }, { status: 500 })
            }
            return Response.json({ schedule: sanitizeSchedule(created) })
        }

        // Edits keep the planned window and recompute when its poll goes out
        // under the new send settings; the pre-send notice re-arms.
        const cursor = computeCursor(group, config, existing.next_window_start)
        const { data: updated, error: updateError } = await supabaseAdmin
            .from('group_schedules')
            .update({
                ...config,
                ...cursor,
                presend_notice_sent_for: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
            .select('*')
            .single()

        if (updateError || !updated) {
            return Response.json({ error: 'Could not save automatic-poll settings.' }, { status: 500 })
        }
        return Response.json({ schedule: sanitizeSchedule(updated) })
    }

    if (body.action === 'pause_schedule' || body.action === 'resume_schedule') {
        const { schedule, error: scheduleError } = await getGroupSchedule(supabaseAdmin, group.id)
        if (scheduleError) {
            return Response.json({ error: scheduleError }, { status: 500 })
        }
        if (!schedule) {
            return Response.json({ error: 'Automatic polls are not set up for this group.' }, { status: 404 })
        }

        let updates
        if (body.action === 'pause_schedule') {
            updates = { paused_at: new Date().toISOString() }
        } else {
            // Resume re-anchors to the next FUTURE period — never catch-up
            // fires a poll for a period missed while paused.
            const configResult = validateScheduleConfig(group, schedule)
            if (configResult.error) {
                return Response.json({ error: `Can't resume: ${configResult.error}` }, { status: 400 })
            }
            updates = {
                paused_at: null,
                presend_notice_sent_for: null,
                ...computeFirstWindow(group, configResult.config, {
                    anchorEvent: await getLatestGroupEvent(supabaseAdmin, group.id),
                    today: todayDateString(),
                }),
            }
        }

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('group_schedules')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', schedule.id)
            .select('*')
            .single()

        if (updateError || !updated) {
            return Response.json({ error: 'Could not update automatic polls.' }, { status: 500 })
        }
        return Response.json({ schedule: sanitizeSchedule(updated) })
    }

    if (body.action === 'add_member') {
        const { member, error, status } = await addMemberToGroup(supabaseAdmin, group, {
            displayName: body.displayName,
            email: body.email,
        })

        if (!member) {
            return Response.json({ error }, { status: status || 500 })
        }

        return Response.json({ member: sanitizeMember(member) })
    }

    if (body.action === 'update_member') {
        const member = await getActiveMember(supabaseAdmin, group, body.memberId)
        if (!member) {
            return Response.json({ error: 'Member not found.' }, { status: 404 })
        }

        const updates = {}

        if (body.displayName !== undefined) {
            const name = (body.displayName || '').trim().slice(0, 80)
            if (!name) {
                return Response.json({ error: 'Member name is required.' }, { status: 400 })
            }
            updates.display_name = name
        }

        if (body.email !== undefined) {
            const normalized = normalizeEmail(body.email)
            if (!normalized) {
                return Response.json({ error: 'A valid email is required.' }, { status: 400 })
            }

            // Setting an email repoints the membership at the email's
            // participant (resolve-or-create). Responses the placeholder
            // participant already made stay put — the host can link_response
            // if attendance matters.
            const { data: participant, error: participantError } = await supabaseAdmin
                .from('participants')
                .upsert({ email: normalized }, { onConflict: 'email', ignoreDuplicates: false })
                .select('*')
                .single()

            if (participantError || !participant) {
                return Response.json({ error: 'Could not resolve that email to a person.' }, { status: 500 })
            }

            if (participant.id !== member.participant_id) {
                const { data: duplicateRows } = await supabaseAdmin
                    .from('group_members')
                    .select('id')
                    .eq('group_id', group.id)
                    .eq('participant_id', participant.id)
                    .is('removed_at', null)
                    .limit(1)

                if (duplicateRows && duplicateRows.length > 0) {
                    return Response.json({ error: 'Another member already has that email.' }, { status: 409 })
                }

                updates.participant_id = participant.id
            }

            updates.invited_email = normalized
        }

        if (Object.keys(updates).length === 0) {
            return Response.json({ error: 'Nothing to update.' }, { status: 400 })
        }

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('group_members')
            .update(updates)
            .eq('id', member.id)
            .select('id, group_id, participant_id, display_name, invited_email, member_token, removed_at, created_at, participants(email)')
            .single()

        if (updateError || !updated) {
            return Response.json({ error: 'Could not update the member.' }, { status: 500 })
        }

        return Response.json({ member: sanitizeMember(updated) })
    }

    if (body.action === 'remove_member') {
        const member = await getActiveMember(supabaseAdmin, group, body.memberId)
        if (!member) {
            return Response.json({ error: 'Member not found.' }, { status: 404 })
        }

        const { error: removeError } = await supabaseAdmin
            .from('group_members')
            .update({ removed_at: new Date().toISOString() })
            .eq('id', member.id)

        if (removeError) {
            return Response.json({ error: 'Could not remove the member.' }, { status: 500 })
        }

        return Response.json({ removed: true })
    }

    if (body.action === 'set_attendance') {
        const member = await getActiveMember(supabaseAdmin, group, body.memberId)
        if (!member) {
            return Response.json({ error: 'Member not found.' }, { status: 404 })
        }

        const event = await getGroupEvent(supabaseAdmin, group, body.eventId)
        if (!event) {
            return Response.json({ error: 'Event not found in this group.' }, { status: 404 })
        }

        const attended = body.attended
        if (attended !== true && attended !== false && attended !== null) {
            return Response.json({ error: 'attended must be true, false, or null.' }, { status: 400 })
        }

        const { data: existingRows } = await supabaseAdmin
            .from('group_event_attendance')
            .select('*')
            .eq('event_id', event.id)
            .eq('member_id', member.id)
            .limit(1)

        const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null

        // Clearing the override deletes the row entirely when there's no
        // response link left to preserve — auto applies again.
        if (attended === null && existing && !existing.linked_response_id) {
            const { error: deleteError } = await supabaseAdmin
                .from('group_event_attendance')
                .delete()
                .eq('id', existing.id)

            if (deleteError) {
                return Response.json({ error: 'Could not clear the override.' }, { status: 500 })
            }

            return Response.json({ attendance: null })
        }

        if (attended === null && !existing) {
            return Response.json({ attendance: null })
        }

        const { data: saved, error: saveError } = await supabaseAdmin
            .from('group_event_attendance')
            .upsert(
                {
                    group_id: group.id,
                    event_id: event.id,
                    member_id: member.id,
                    attended_override: attended,
                    linked_response_id: existing?.linked_response_id ?? null,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'event_id,member_id' }
            )
            .select('event_id, member_id, attended_override, linked_response_id')
            .single()

        if (saveError || !saved) {
            return Response.json({ error: 'Could not save attendance.' }, { status: 500 })
        }

        return Response.json({ attendance: saved })
    }

    if (body.action === 'link_response') {
        const member = await getActiveMember(supabaseAdmin, group, body.memberId)
        if (!member) {
            return Response.json({ error: 'Member not found.' }, { status: 404 })
        }

        const event = await getGroupEvent(supabaseAdmin, group, body.eventId)
        if (!event) {
            return Response.json({ error: 'Event not found in this group.' }, { status: 404 })
        }

        const responseId = body.responseId ?? null

        if (responseId) {
            const { data: responseRows } = await supabaseAdmin
                .from('responses')
                .select('id')
                .eq('id', responseId)
                .eq('event_id', event.id)
                .is('deleted_at', null)
                .limit(1)

            if (!responseRows || responseRows.length === 0) {
                return Response.json({ error: 'Response not found on this event.' }, { status: 404 })
            }
        }

        const { data: existingRows } = await supabaseAdmin
            .from('group_event_attendance')
            .select('*')
            .eq('event_id', event.id)
            .eq('member_id', member.id)
            .limit(1)

        const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null

        // Unlinking with no override left → drop the row.
        if (!responseId && existing && existing.attended_override === null) {
            const { error: deleteError } = await supabaseAdmin
                .from('group_event_attendance')
                .delete()
                .eq('id', existing.id)

            if (deleteError) {
                return Response.json({ error: 'Could not unlink the response.' }, { status: 500 })
            }

            return Response.json({ attendance: null })
        }

        if (!responseId && !existing) {
            return Response.json({ attendance: null })
        }

        const { data: saved, error: saveError } = await supabaseAdmin
            .from('group_event_attendance')
            .upsert(
                {
                    group_id: group.id,
                    event_id: event.id,
                    member_id: member.id,
                    attended_override: existing?.attended_override ?? null,
                    linked_response_id: responseId,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'event_id,member_id' }
            )
            .select('event_id, member_id, attended_override, linked_response_id')
            .single()

        if (saveError || !saved) {
            return Response.json({ error: 'Could not link the response.' }, { status: 500 })
        }

        return Response.json({ attendance: saved })
    }

    return Response.json({ error: 'Unsupported action.' }, { status: 400 })
}
