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
