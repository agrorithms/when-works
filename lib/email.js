// Server-only transactional email via the Resend REST API. Plain fetch — one
// endpoint doesn't justify the SDK dependency. When the env vars are missing
// (local dev, or email deliberately disabled) everything no-ops gracefully.

export function isEmailEnabled() {
    return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
}

export async function sendEmail({ to, subject, html, text }) {
    if (!isEmailEnabled()) {
        console.log(`[email] skipped (RESEND env not set): "${subject}" → ${to}`)
        return { skipped: true }
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL,
                to: [to],
                subject,
                html,
                text,
            }),
        })

        if (!res.ok) {
            const detail = await res.text().catch(() => '')
            console.error(`[email] Resend ${res.status} for "${subject}" → ${to}: ${detail}`)
            return { error: `Resend responded ${res.status}` }
        }

        return { sent: true }
    } catch (error) {
        console.error(`[email] send failed for "${subject}" → ${to}:`, error)
        return { error: error?.message || 'Send failed' }
    }
}

function formatDeadline(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
}

// Emails every active member (with an email) their per-member respond link
// for a newly created group event. Best-effort: failures are counted, never
// thrown — event creation must not fail because email did.
export async function sendGroupEventEmails({ group, event, members, baseUrl }) {
    const recipients = (members || []).filter((member) => !member.removed_at && member.invited_email)

    if (recipients.length === 0 || !isEmailEnabled()) {
        return { emailedCount: 0, failedCount: 0 }
    }

    const subject = `${group.name}: pick dates for "${event.title}"`
    const deadline = event.response_deadline ? formatDeadline(event.response_deadline) : null

    const results = await Promise.allSettled(
        recipients.map((member) => {
            const link = `${baseUrl}/respond/${event.slug}?m=${member.member_token}`
            const deadlineLine = deadline ? `Respond by ${deadline}.` : ''
            return sendEmail({
                to: member.invited_email,
                subject,
                html: `
                    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                        <p style="font-size: 16px; color: #0f172a;">Hi ${member.display_name},</p>
                        <p style="font-size: 16px; color: #0f172a;"><strong>${group.name}</strong> is planning <strong>${event.title}</strong> — pick the dates that work for you.</p>
                        <p style="margin: 28px 0;">
                            <a href="${link}" style="background: #6366f1; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 16px;">Pick your dates</a>
                        </p>
                        ${deadlineLine ? `<p style="font-size: 14px; color: #475569;">${deadlineLine}</p>` : ''}
                        <p style="font-size: 12px; color: #94a3b8;">This link is yours — it identifies you automatically, no sign-up needed.</p>
                    </div>
                `,
                text: `Hi ${member.display_name},\n\n${group.name} is planning "${event.title}" — pick the dates that work for you:\n${link}\n\n${deadlineLine}`.trim(),
            })
        })
    )

    let emailedCount = 0
    let failedCount = 0
    for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.sent) emailedCount += 1
        else failedCount += 1
    }

    return { emailedCount, failedCount }
}

const BUTTON_STYLE = 'background: #6366f1; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 16px;'

// 3 days before the next auto poll goes out, when the previous one never got
// a date picked: heads-up + one-click pause. Creation proceeds regardless if
// the owner takes no action.
export async function sendPresendNoticeEmail({ group, schedule, previousEvent, sendDate, baseUrl }) {
    const manageLink = `${baseUrl}${group.manage_token ? `/groups/manage/${group.manage_token}` : `/groups/manage/${group.id}`}`
    const pauseLink = `${baseUrl}/groups/pause/${schedule.pause_token}`
    const sendDateLabel = formatDeadline(sendDate)

    return sendEmail({
        to: schedule.notify_email,
        subject: `${group.name}: next poll goes out ${sendDateLabel} — last one was never finalized`,
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <p style="font-size: 16px; color: #0f172a;">The next <strong>${group.name}</strong> poll goes out on <strong>${sendDateLabel}</strong>.</p>
                <p style="font-size: 16px; color: #0f172a;">Heads up: the previous poll, <strong>${previousEvent.title}</strong>, never had a date picked. If the group isn't ready for another poll, you can pause automatic polls — otherwise the new poll will go out as scheduled.</p>
                <p style="margin: 28px 0;">
                    <a href="${manageLink}" style="${BUTTON_STYLE}">Open the group</a>
                </p>
                <p style="font-size: 14px; color: #475569;"><a href="${pauseLink}" style="color: #6366f1;">Pause automatic polls for ${group.name}</a></p>
            </div>
        `,
        text: `The next ${group.name} poll goes out on ${sendDateLabel}.\n\nHeads up: the previous poll, "${previousEvent.title}", never had a date picked. If the group isn't ready for another poll, you can pause automatic polls — otherwise the new poll will go out as scheduled.\n\nOpen the group: ${manageLink}\nPause automatic polls: ${pauseLink}`,
    })
}

function formatTime12h(timeStr) {
    if (!timeStr) return ''
    const [h, m] = timeStr.split(':').map(Number)
    const suffix = h < 12 ? 'AM' : 'PM'
    const hour12 = h % 12 === 0 ? 12 : h % 12
    return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`
}

// One summary per poll, to the owner: either everyone confirmed, or the
// response deadline passed. Includes the tally and top candidate dates.
// `autoSchedule` (opted-in auto polls only) turns it into a warning: the app
// creates the calendar event tomorrow — here's the date it would pick right
// now and who's available then, recomputed at generation time.
export async function sendOwnerSummaryEmail({ group, event, summary, reason, to, baseUrl, autoSchedule = null }) {
    const manageLink = `${baseUrl}${summary.manageLink}`
    const allResponded = reason === 'all_responded'
    const subject = allResponded
        ? `${group.name}: everyone responded to "${event.title}"`
        : `${group.name}: response deadline passed for "${event.title}"`

    const tally = `${summary.confirmedCount} of ${summary.rosterCount} member${summary.rosterCount === 1 ? '' : 's'} confirmed their dates`
    const topDatesHtml = summary.topDates.length > 0
        ? `<p style="font-size: 16px; color: #0f172a; margin-bottom: 4px;"><strong>Top candidate dates:</strong></p>
           <ul style="font-size: 16px; color: #0f172a; margin-top: 4px;">
               ${summary.topDates.map(({ date, count }) => `<li>${formatDeadline(date)} — ${count} available</li>`).join('')}
           </ul>`
        : `<p style="font-size: 16px; color: #0f172a;">No dates have been marked available yet.</p>`
    const topDatesText = summary.topDates.length > 0
        ? `Top candidate dates:\n${summary.topDates.map(({ date, count }) => `- ${formatDeadline(date)} — ${count} available`).join('\n')}`
        : 'No dates have been marked available yet.'

    let autoHtml = ''
    let autoText = ''
    if (autoSchedule) {
        const groupLink = `${baseUrl}${autoSchedule.groupManageLink}`
        const predicted = autoSchedule.predictedDate
            ? `As of right now it would pick <strong>${formatDeadline(autoSchedule.predictedDate)}</strong> at <strong>${formatTime12h(autoSchedule.eventTime)}</strong>${autoSchedule.availableNames.length > 0 ? `, with ${autoSchedule.availableNames.join(', ')} available` : ''}. That gets recomputed from the latest responses when the event is created.`
            : 'Right now no offered date has anyone available — if that is still true tomorrow, no event will be created and you will get an email instead.'
        const predictedText = autoSchedule.predictedDate
            ? `As of right now it would pick ${formatDeadline(autoSchedule.predictedDate)} at ${formatTime12h(autoSchedule.eventTime)}${autoSchedule.availableNames.length > 0 ? `, with ${autoSchedule.availableNames.join(', ')} available` : ''}. That gets recomputed from the latest responses when the event is created.`
            : 'Right now no offered date has anyone available — if that is still true tomorrow, no event will be created and you will get an email instead.'
        const stale = autoSchedule.staleToken
            ? `<p style="font-size: 14px; color: #b45309;">⚠️ Your Google connection is likely expired (last connected over 7 days ago). Sign in to the app again before tomorrow so the calendar event can be created.</p>`
            : ''
        const staleText = autoSchedule.staleToken
            ? '\n\nWARNING: Your Google connection is likely expired (last connected over 7 days ago). Sign in to the app again before tomorrow so the calendar event can be created.'
            : ''
        autoHtml = `
                <div style="background: #eef2ff; border-radius: 8px; padding: 12px 16px; margin-top: 16px;">
                    <p style="font-size: 15px; color: #0f172a;"><strong>⚡ Auto-scheduling is on:</strong> tomorrow the app will pick the best date, create the Google Calendar event from your account, and send the invites.</p>
                    <p style="font-size: 15px; color: #0f172a;">${predicted}</p>
                    ${stale}
                    <p style="font-size: 14px; color: #475569;">Want to pick the date yourself or stop the automation? <a href="${groupLink}" style="color: #6366f1;">Open the group</a> before tomorrow.</p>
                </div>`
        autoText = `\n\nAUTO-SCHEDULING IS ON: tomorrow the app will pick the best date, create the Google Calendar event from your account, and send the invites.\n${predictedText}${staleText}\nWant to pick the date yourself or stop the automation? Open the group before tomorrow: ${groupLink}`
    }

    return sendEmail({
        to,
        subject,
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <p style="font-size: 16px; color: #0f172a;">${allResponded
                    ? `Everyone in <strong>${group.name}</strong> has responded to <strong>${event.title}</strong>.`
                    : `The response deadline for <strong>${event.title}</strong> has passed.`}</p>
                <p style="font-size: 16px; color: #0f172a;">${tally}.</p>
                ${topDatesHtml}
                ${autoHtml}
                <p style="margin: 28px 0;">
                    <a href="${manageLink}" style="${BUTTON_STYLE}">${autoSchedule ? 'Review the poll' : 'Pick the date'}</a>
                </p>
            </div>
        `,
        text: `${allResponded
            ? `Everyone in ${group.name} has responded to "${event.title}".`
            : `The response deadline for "${event.title}" has passed.`}\n\n${tally}.\n\n${topDatesText}${autoText}\n\n${autoSchedule ? 'Review the poll' : 'Pick the date'}: ${manageLink}`,
    })
}

function bucketSection(title, names) {
    if (!names || names.length === 0) return { html: '', text: '' }
    return {
        html: `<p style="font-size: 15px; color: #0f172a; margin-bottom: 2px;"><strong>${title}</strong></p>
               <ul style="font-size: 15px; color: #0f172a; margin-top: 2px;">${names.map((n) => `<li>${n}</li>`).join('')}</ul>`,
        text: `\n${title}\n${names.map((n) => `- ${n}`).join('\n')}\n`,
    }
}

// After the cron creates the calendar event: what got scheduled, plus a
// complete roster accounting — every member appears in exactly one list, so
// the owner can see who needs a manual forward and why.
export async function sendAutoScheduledEmail({ group, event, to, baseUrl, selectedDate, eventTime, timezone, eventUrl, buckets, manageLink }) {
    const dateLabel = formatDeadline(selectedDate)
    const timeLabel = formatTime12h(eventTime)

    const sections = [
        bucketSection(`✅ Invited (${buckets.invited.length})`, buckets.invited.map((m) => m.display_name)),
        bucketSection('📭 Not invited — no email on file', buckets.noEmail.map((m) => m.display_name)),
        bucketSection('🤷 Not invited — didn\'t respond to the poll', buckets.notResponded.map((m) => m.display_name)),
        bucketSection('🗓️ Not invited — not available that day', buckets.notAvailable.map((m) => m.display_name)),
        bucketSection('👋 Additional responses, not invited (not in the group)', buckets.nonMembers.map((r) => r.display_name)),
    ]

    return sendEmail({
        to,
        subject: `${group.name}: scheduled "${event.title}" for ${dateLabel}`,
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <p style="font-size: 16px; color: #0f172a;"><strong>${event.title}</strong> is scheduled: <strong>${dateLabel}</strong> at <strong>${timeLabel}</strong> (${timezone}).</p>
                <p style="font-size: 16px; color: #0f172a;">The Google Calendar event was created from your account and invites were sent.</p>
                ${sections.map((s) => s.html).join('')}
                <p style="font-size: 14px; color: #475569;">Anyone not invited needs a manual forward if you want them there — open the event in Google Calendar and add their email.</p>
                <p style="margin: 28px 0;">
                    ${eventUrl ? `<a href="${eventUrl}" style="${BUTTON_STYLE}">Open in Google Calendar</a>` : ''}
                </p>
                <p style="font-size: 14px; color: #475569;"><a href="${baseUrl}${manageLink}" style="color: #6366f1;">Open the poll</a></p>
            </div>
        `,
        text: `"${event.title}" is scheduled: ${dateLabel} at ${timeLabel} (${timezone}).\n\nThe Google Calendar event was created from your account and invites were sent.\n${sections.map((s) => s.text).join('')}\nAnyone not invited needs a manual forward if you want them there — open the event in Google Calendar and add their email.\n\nGoogle Calendar: ${eventUrl || '(no link returned)'}\nOpen the poll: ${baseUrl}${manageLink}`,
    })
}

// Generation day arrived but no event could be created. Two flavors:
// 'no_availability' (no future date has an available respondent) and
// 'reconnect_google' (the stored Google credential is dead — sign in again).
// Either way the attempt is consumed: schedule manually, no retry.
export async function sendAutoScheduleFailedEmail({ group, event, to, baseUrl, reason, detail, manageLink }) {
    const reconnect = reason === 'reconnect_google'
    const subject = reconnect
        ? `${group.name}: reconnect Google to auto-schedule "${event.title}"`
        : `${group.name}: couldn't auto-schedule "${event.title}"`
    const body = reconnect
        ? 'Your Google connection has expired or been revoked, so the calendar event could not be created. Sign in to the app again to reconnect — future polls will then auto-schedule — and schedule this one manually.'
        : 'No offered date has anyone available (or every workable date has already passed), so no calendar event was created. You can pick a date manually from the poll.'

    return sendEmail({
        to,
        subject,
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <p style="font-size: 16px; color: #0f172a;">Auto-scheduling for <strong>${event.title}</strong> didn't run today.</p>
                <p style="font-size: 16px; color: #0f172a;">${body}</p>
                ${detail ? `<p style="font-size: 13px; color: #94a3b8;">Details: ${detail}</p>` : ''}
                <p style="margin: 28px 0;">
                    <a href="${baseUrl}${manageLink}" style="${BUTTON_STYLE}">Open the poll</a>
                </p>
            </div>
        `,
        text: `Auto-scheduling for "${event.title}" didn't run today.\n\n${body}\n${detail ? `\nDetails: ${detail}\n` : ''}\nOpen the poll: ${baseUrl}${manageLink}`,
    })
}
