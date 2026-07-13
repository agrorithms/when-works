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

// One summary per poll, to the owner: either everyone confirmed, or the
// response deadline passed. Includes the tally and top candidate dates.
export async function sendOwnerSummaryEmail({ group, event, summary, reason, to, baseUrl }) {
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
                <p style="margin: 28px 0;">
                    <a href="${manageLink}" style="${BUTTON_STYLE}">Pick the date</a>
                </p>
            </div>
        `,
        text: `${allResponded
            ? `Everyone in ${group.name} has responded to "${event.title}".`
            : `The response deadline for "${event.title}" has passed.`}\n\n${tally}.\n\n${topDatesText}\n\nPick the date: ${manageLink}`,
    })
}
