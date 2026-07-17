'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { saveGroupToken } from '../../../../lib/savedGroupTokens'
import {
    CADENCE_CHOICES,
    cadenceChoiceValue,
    cadenceFromChoice,
    computeDeadline,
    formatWindowLabel,
    maxDate,
    maxDeadlineDays,
    previewOccurrences,
} from '../../../../lib/schedule'
import { AUTO_INVITE_SCOPES, AUTO_INVITE_SCOPE_LABELS } from '../../../../lib/autoSchedule'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const TIMEZONES_FALLBACK = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']

function browserTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'America/New_York' }
}

function listTimezones() {
    try { return Intl.supportedValuesOf('timeZone') } catch { return TIMEZONES_FALLBACK }
}

function getToday() {
    const now = new Date()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${m}-${d}`
}

function addDays(dateStr, days) {
    const date = new Date(dateStr + 'T12:00:00')
    date.setDate(date.getDate() + days)
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${m}-${d}`
}

function formatDate(dateStr) {
    if (!dateStr) return ''
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

function formatDateWithWeekday(dateStr) {
    if (!dateStr) return ''
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    })
}

function weekdayName(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
}

// Live preview of what the schedule draft will do — the same date math the
// save route and cron run, so what's shown is what happens. Returns
// { invalid } for incomplete drafts, { warning } when the response window
// won't fit (mirrors the server rejection), else { occurrences: [next, then] }.
function buildSchedulePreview(group, schedDraft, schedule, anchorEvent, today) {
    const isMonth = group.cadence_unit === 'month'
    const deadlineDays = Number(schedDraft.deadlineDays)
    const sendDay = Number(schedDraft.sendDay)
    const leadDays = Number(schedDraft.leadDays)

    if (!Number.isInteger(deadlineDays) || deadlineDays < 1) return { invalid: true }
    if (isMonth && (!Number.isInteger(sendDay) || sendDay < 1 || sendDay > 27)) return { invalid: true }
    if (!isMonth && (!Number.isInteger(leadDays) || leadDays < 2 || leadDays > 60)) return { invalid: true }

    const cap = maxDeadlineDays(group, { sendDayOfMonth: sendDay, leadDays })
    if (deadlineDays > cap) {
        const days = `${cap} day${cap === 1 ? '' : 's'}`
        return {
            warning: isMonth
                ? `With a send day of the ${sendDay}, members can get at most ${days} to respond — otherwise the poll would close after the month starts.`
                : `With polls going out ${leadDays} days ahead, members can get at most ${days} to respond — otherwise the poll would close after the period starts.`,
        }
    }

    return {
        occurrences: previewOccurrences(group, {
            send_day_of_month: isMonth ? sendDay : null,
            lead_days: isMonth ? null : leadDays,
            deadline_days: deadlineDays,
        }, { schedule, anchorEvent, today }),
    }
}

function TimelineCell({ icon, date, label }) {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#e2e8f0', fontSize: '0.88rem', whiteSpace: 'nowrap' }}>{icon} {date}</div>
            <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{label}</div>
        </div>
    )
}

function TimelineConnector() {
    return <div style={{ flex: '1 1 20px', minWidth: '14px', borderTop: '1px dashed #475569' }} />
}

function SchedulePreview({ group, preview }) {
    if (preview.invalid) {
        return (
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Enter valid values above to preview the schedule.
            </p>
        )
    }

    if (preview.warning) {
        return (
            <p style={{ color: '#fbbf24', fontSize: '0.85rem', marginBottom: '1rem' }}>
                ⚠️ {preview.warning}
            </p>
        )
    }

    const [next, then] = preview.occurrences
    const isMonth = group.cadence_unit === 'month'
    const sentWeekday = weekdayName(then.sendOn)
    const dueWeekday = weekdayName(then.deadlineOn)
    const windowLabel = formatWindowLabel(group, next.windowStart, next.windowEnd)

    return (
        <div style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: '12px',
            padding: '0.9rem 1rem', marginBottom: '1rem',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <TimelineCell
                    icon="📤"
                    date={next.isCatchUp ? 'As soon as you save' : formatDateWithWeekday(next.effectiveSendOn)}
                    label="poll sent"
                />
                <TimelineConnector />
                <TimelineCell icon="⏰" date={formatDateWithWeekday(next.deadlineOn)} label="responses due" />
                <TimelineConnector />
                <TimelineCell icon="📅" date={isMonth ? `covers ${windowLabel}` : windowLabel} label="poll window" />
            </div>

            {isMonth ? (
                <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: '0.6rem' }}>
                    Then: sent {formatDateWithWeekday(then.sendOn)} · due {formatDateWithWeekday(then.deadlineOn)}
                    {' '}→ covers {formatWindowLabel(group, then.windowStart, then.windowEnd)}
                </p>
            ) : (
                <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: '0.6rem' }}>
                    Repeats {group.cadence_interval === 7 ? 'every week' : 'every 2 weeks'} — sent{' '}
                    <strong style={{ color: '#c7d2fe' }}>{sentWeekday}s</strong>, responses due{' '}
                    <strong style={{ color: '#c7d2fe' }}>{dueWeekday}s</strong>.
                </p>
            )}

            {next.isCatchUp && (
                <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: '0.4rem' }}>
                    The first poll goes out at the next daily run
                    {isMonth ? '.' : <>; after that, polls are sent every <strong style={{ color: '#c7d2fe' }}>{sentWeekday}</strong>.</>}
                </p>
            )}
        </div>
    )
}

// "Plan next hangout" prefill: title "<Group> — <Month Year>", range from
// the cadence (day: one period from today; month: through end of next month;
// no cadence: 21 days).
function planNextHref(group, ref) {
    const today = getToday()
    const now = new Date()
    const title = `${group.name} — ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    let end
    if (group.cadence_unit === 'month') {
        const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0)
        const m = String(endOfNextMonth.getMonth() + 1).padStart(2, '0')
        const d = String(endOfNextMonth.getDate()).padStart(2, '0')
        end = `${endOfNextMonth.getFullYear()}-${m}-${d}`
    } else {
        end = addDays(today, Math.min(group.cadence_interval ?? 21, 30))
    }
    const query = new URLSearchParams({
        group: ref,
        groupName: group.name,
        title,
        start: today,
        end,
    })
    return `/events/new?${query.toString()}`
}

export default function GroupManagePage() {
    const params = useParams()
    const ref = params.ref
    const { data: session } = useSession()

    const [bundle, setBundle] = useState(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    const [actionError, setActionError] = useState('')
    const [copied, setCopied] = useState('')

    const [nameDraft, setNameDraft] = useState('')
    const [editingName, setEditingName] = useState(false)

    const [addName, setAddName] = useState('')
    const [addEmail, setAddEmail] = useState('')
    const [addLoading, setAddLoading] = useState(false)

    const [editingMemberId, setEditingMemberId] = useState(null)
    const [editMemberName, setEditMemberName] = useState('')
    const [editMemberEmail, setEditMemberEmail] = useState('')
    const [removingMemberId, setRemovingMemberId] = useState(null)

    const [linkDrafts, setLinkDrafts] = useState({})

    const [editingSchedule, setEditingSchedule] = useState(false)
    const [schedDraft, setSchedDraft] = useState(null)
    const [schedSaving, setSchedSaving] = useState(false)
    const [pausePrompt, setPausePrompt] = useState(false)
    const [timezones] = useState(listTimezones)

    const fetchBundle = useCallback(async () => {
        try {
            const res = await fetch(`/api/groups/manage/${ref}`)
            if (!res.ok) {
                setNotFound(true)
                return null
            }
            const data = await res.json()
            setBundle(data)
            return data
        } catch {
            setNotFound(true)
            return null
        }
    }, [ref])

    useEffect(() => {
        const load = async () => {
            const data = await fetchBundle()
            setLoading(false)
            // A link-mode group opened via its manage token: remember it on
            // this browser (same pattern as saved owner links for events).
            if (data?.group?.manageLink === `/groups/manage/${ref}` && data.group.access_mode === 'link') {
                saveGroupToken(ref)
            }
        }
        load()
    }, [fetchBundle, ref])

    const post = useCallback(async (action, payload = {}) => {
        setActionError('')
        try {
            const res = await fetch(`/api/groups/manage/${ref}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...payload }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setActionError(data.error || 'Something went wrong.')
                return false
            }
            await fetchBundle()
            return true
        } catch {
            setActionError('Something went wrong. Please try again.')
            return false
        }
    }, [ref, fetchBundle])

    const copyToClipboard = (text, label) => {
        navigator.clipboard.writeText(text)
        setCopied(label)
        setTimeout(() => setCopied(''), 1500)
    }

    if (loading) {
        return (
            <div className="container" style={{ paddingTop: '3rem', textAlign: 'center' }}>
                <h2>Loading group...</h2>
            </div>
        )
    }

    if (notFound || !bundle?.group) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h1>😕</h1>
                <h1>Group Not Found</h1>
                <h2>This group link doesn&apos;t exist or you don&apos;t have access.</h2>
                <Link href="/groups" className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    ← Back to groups
                </Link>
            </div>
        )
    }

    const { group, members, events, nudge, schedule, pendingAutoSchedule, ownerCalendar } = bundle
    const countableEvents = events.filter((event) => event.countable)
    const planHref = planNextHref(group, ref)
    const automationActive = Boolean(schedule && !schedule.paused_at)
    const today = getToday()
    // events[0] is the newest by created_at — the same anchor the save route
    // uses when creating a schedule, so the preview matches it exactly.
    const schedPreview = editingSchedule && schedDraft
        ? buildSchedulePreview(group, schedDraft, schedule, events[0] ?? null, today)
        : null
    const nextDeadlineOn = automationActive
        ? computeDeadline(maxDate(schedule.next_send_on, today), schedule.deadline_days, schedule.next_window_start)
        : null
    // Testing-mode Google tokens die after ~7 days; warn when the stored one
    // is older than that (date-granular, same as the cron's view of time).
    const tokenLikelyStale = Boolean(
        ownerCalendar?.grantedAt && addDays(ownerCalendar.grantedAt.slice(0, 10), 7) < today
    )

    const startEditSchedule = () => {
        setSchedDraft({
            excludedWeekdays: schedule?.excluded_weekdays || [],
            sendDay: String(schedule?.send_day_of_month ?? 20),
            leadDays: String(schedule?.lead_days ?? 7),
            deadlineDays: String(schedule?.deadline_days ?? 5),
            notifyEmail: schedule?.notify_email || session?.user?.email || '',
            autoEnabled: Boolean(schedule?.auto_schedule_enabled),
            autoTime: schedule?.auto_event_time || '18:00',
            autoTimezone: schedule?.auto_event_timezone || browserTimezone(),
            autoScope: schedule?.auto_invite_scope || 'available',
        })
        setEditingSchedule(true)
    }

    const toggleWeekday = (day) => {
        setSchedDraft((prev) => ({
            ...prev,
            excludedWeekdays: prev.excludedWeekdays.includes(day)
                ? prev.excludedWeekdays.filter((d) => d !== day)
                : [...prev.excludedWeekdays, day],
        }))
    }

    const saveSchedule = async () => {
        setSchedSaving(true)
        const ok = await post('update_schedule', {
            excluded_weekdays: schedDraft.excludedWeekdays,
            send_day_of_month: group.cadence_unit === 'month' ? Number(schedDraft.sendDay) : null,
            lead_days: group.cadence_unit === 'day' ? Number(schedDraft.leadDays) : null,
            deadline_days: Number(schedDraft.deadlineDays),
            notify_email: schedDraft.notifyEmail,
            auto_schedule_enabled: schedDraft.autoEnabled,
            auto_event_time: schedDraft.autoTime,
            auto_event_timezone: schedDraft.autoTimezone,
            auto_invite_scope: schedDraft.autoScope,
        })
        setSchedSaving(false)
        if (ok) setEditingSchedule(false)
    }

    const pauseSchedule = async (cancelPendingGeneration) => {
        setPausePrompt(false)
        await post('pause_schedule', { cancelPendingGeneration })
    }

    const startEditMember = (member) => {
        setEditingMemberId(member.id)
        setEditMemberName(member.display_name)
        setEditMemberEmail(member.invited_email || '')
    }

    const saveMemberEdit = async (member) => {
        const payload = { memberId: member.id }
        if (editMemberName.trim() !== member.display_name) payload.displayName = editMemberName
        const emailChanged = editMemberEmail.trim().toLowerCase() !== (member.invited_email || '')
        if (emailChanged && editMemberEmail.trim()) payload.email = editMemberEmail
        if (Object.keys(payload).length === 1) {
            setEditingMemberId(null)
            return
        }
        const ok = await post('update_member', payload)
        if (ok) setEditingMemberId(null)
    }

    const cycleAttendance = (event, member) => {
        const cell = event.attendance?.[member.id]
        const auto = Boolean(cell?.auto)
        const effective = Boolean(cell?.attended)
        const desired = !effective
        // Flipping back to what auto already says clears the override.
        const next = desired === auto ? null : desired
        post('set_attendance', { eventId: event.id, memberId: member.id, attended: next })
    }

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a' }}>
            <div className="container" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
                <Link href="/groups" className="nav-link">
                    ← Back to groups
                </Link>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '0.75rem' }}>
                    <div style={{ flex: '1 1 300px' }}>
                        {editingName ? (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                    type="text"
                                    className="input-field"
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    style={{ marginBottom: 0, maxWidth: '320px' }}
                                />
                                <button
                                    className="button-primary"
                                    onClick={async () => {
                                        const ok = await post('update_group', { name: nameDraft })
                                        if (ok) setEditingName(false)
                                    }}
                                >
                                    Save
                                </button>
                                <button className="button-secondary" onClick={() => setEditingName(false)}>
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <h1>
                                👥 {group.name}
                                {' '}
                                <span
                                    style={{ color: '#6366f1', cursor: 'pointer', fontSize: '1rem', verticalAlign: 'middle' }}
                                    onClick={() => { setNameDraft(group.name); setEditingName(true) }}
                                >
                                    ✎
                                </span>
                            </h1>
                        )}

                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Cadence:</label>
                            <select
                                className="input-field"
                                value={cadenceChoiceValue(group)}
                                onChange={(e) => post('update_group', {
                                    cadence: cadenceFromChoice(e.target.value, group.cadence_anchor_day ?? 15),
                                })}
                                style={{ marginBottom: 0, maxWidth: '220px' }}
                            >
                                <option value="">No set cadence</option>
                                {CADENCE_CHOICES.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            {group.cadence_unit === 'month' && (
                                <>
                                    <label style={{ color: '#94a3b8', fontSize: '0.85rem' }}>around the</label>
                                    <select
                                        className="input-field"
                                        value={String(group.cadence_anchor_day ?? 15)}
                                        onChange={(e) => post('update_group', {
                                            cadence: cadenceFromChoice(cadenceChoiceValue(group), Number(e.target.value)),
                                        })}
                                        style={{ marginBottom: 0, maxWidth: '90px' }}
                                    >
                                        {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                                            <option key={day} value={String(day)}>{day}</option>
                                        ))}
                                    </select>
                                </>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <Link href={planHref} className="button-primary">
                            ➕ Plan next hangout
                        </Link>
                        {group.access_mode === 'link' && (
                            <button
                                className="button-secondary"
                                onClick={() => copyToClipboard(`${window.location.origin}${group.manageLink}`, 'manage')}
                            >
                                {copied === 'manage' ? 'Copied!' : 'Copy group manage link'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Cadence nudge — replaced by the next-send line when
                    automatic polls are on (the app plans it, not the host). */}
                {automationActive ? (
                    <div style={{
                        background: '#312e81', border: '2px solid #6366f1', borderRadius: '12px',
                        padding: '0.9rem 1rem', marginTop: '1rem',
                    }}>
                        <p style={{ color: '#c7d2fe' }}>
                            📅 Next poll goes out automatically on <strong>{formatDate(schedule.next_send_on)}</strong>
                            {' '}(responses due <strong>{formatDate(nextDeadlineOn)}</strong>)
                            {' '}for {formatDate(schedule.next_window_start)} – {formatDate(schedule.next_window_end)}.
                        </p>
                    </div>
                ) : nudge?.nudge && (
                    <div style={{
                        background: '#312e81', border: '2px solid #6366f1', borderRadius: '12px',
                        padding: '0.9rem 1rem', marginTop: '1rem',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                    }}>
                        <p style={{ color: '#c7d2fe' }}>
                            {nudge.lastDate
                                ? `⏰ It's been ${nudge.daysSinceLast} days since your last hangout (${formatDate(nudge.lastDate)}) — time to plan the next one!`
                                : '⏰ No hangouts on the books yet — plan the first one!'}
                        </p>
                        <Link href={planHref} className="button-primary">
                            Plan it →
                        </Link>
                    </div>
                )}

                {actionError && (
                    <div className="section-card" style={{ marginTop: '1rem', borderColor: '#ef4444' }}>
                        <p style={{ color: '#fca5a5' }}>{actionError}</p>
                    </div>
                )}

                {/* Automatic polls */}
                <div className="section-card" style={{ marginTop: '1.25rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Automatic polls</h2>
                    <p style={{ color: '#94a3b8', marginBottom: '0.9rem' }}>
                        On your cadence, the app creates the next poll, emails members their personal links,
                        and emails you when everyone has responded or the deadline passes.
                    </p>

                    {schedule?.last_error && (
                        <p style={{ color: '#fbbf24', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                            ⚠️ Last run note: {schedule.last_error}
                        </p>
                    )}

                    {!editingSchedule && !schedule && (
                        <div>
                            {group.cadence_unit ? (
                                <button className="button-primary" onClick={startEditSchedule}>
                                    Set up automatic polls
                                </button>
                            ) : (
                                <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                                    Set a cadence above to enable automatic polls.
                                </p>
                            )}
                        </div>
                    )}

                    {!editingSchedule && schedule && (
                        <div>
                            <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
                                {schedule.paused_at
                                    ? '⏸️ Paused — no polls will be sent until you resume.'
                                    : <>Next poll: <strong>{formatDate(schedule.next_send_on)}</strong> · responses due <strong>{formatDate(nextDeadlineOn)}</strong> · for {formatDate(schedule.next_window_start)} – {formatDate(schedule.next_window_end)}.</>}
                            </p>
                            <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: '0.35rem' }}>
                                {schedule.excluded_weekdays.length > 0
                                    ? `Excludes ${schedule.excluded_weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ')}`
                                    : 'All days offered'}
                                {' · '}{schedule.deadline_days} day{schedule.deadline_days === 1 ? '' : 's'} to respond
                                {' · '}notifies {schedule.notify_email}
                            </p>
                            <p style={{ color: schedule.auto_schedule_enabled ? '#a7f3d0' : '#64748b', fontSize: '0.82rem', marginTop: '0.35rem' }}>
                                {schedule.auto_schedule_enabled
                                    ? `⚡ Auto-scheduling on — events at ${schedule.auto_event_time} (${schedule.auto_event_timezone}), invites: ${AUTO_INVITE_SCOPE_LABELS[schedule.auto_invite_scope].toLowerCase()}`
                                    : 'Auto-scheduling off — you pick the date and create the calendar event yourself.'}
                            </p>
                            {pendingAutoSchedule && (
                                <p style={{ color: '#c7d2fe', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                    ⚡ The Google Calendar event for <strong>{pendingAutoSchedule.title}</strong> will be
                                    created automatically on <strong>{formatDate(pendingAutoSchedule.scheduledFor)}</strong>.
                                    Pick a date on the event page before then to schedule it yourself instead.
                                </p>
                            )}
                            {pausePrompt ? (
                                <div style={{ background: '#0f172a', border: '1px solid #6366f1', borderRadius: '12px', padding: '0.75rem 0.9rem', marginTop: '0.75rem' }}>
                                    <p style={{ color: '#c7d2fe', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                                        A calendar event for <strong>{pendingAutoSchedule?.title}</strong> is set to be created
                                        automatically on {formatDate(pendingAutoSchedule?.scheduledFor)}. Should it still happen?
                                    </p>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <button className="button-secondary" style={{ borderColor: '#ef4444', color: '#fca5a5' }} onClick={() => pauseSchedule(true)}>
                                            Pause + cancel the event
                                        </button>
                                        <button className="button-secondary" onClick={() => pauseSchedule(false)}>
                                            Create it, then pause
                                        </button>
                                        <button className="button-secondary" onClick={() => setPausePrompt(false)}>
                                            Never mind
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                                    <button className="button-secondary" onClick={startEditSchedule}>Edit</button>
                                    <button
                                        className="button-secondary"
                                        onClick={() => {
                                            if (schedule.paused_at) {
                                                post('resume_schedule')
                                            } else if (pendingAutoSchedule) {
                                                setPausePrompt(true)
                                            } else {
                                                post('pause_schedule')
                                            }
                                        }}
                                    >
                                        {schedule.paused_at ? '▶ Resume' : '⏸ Pause'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {editingSchedule && schedDraft && (
                        <div>
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                                Days to leave out of every poll
                            </label>
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                                {WEEKDAY_LABELS.map((label, day) => {
                                    const excluded = schedDraft.excludedWeekdays.includes(day)
                                    return (
                                        <button
                                            key={label}
                                            onClick={() => toggleWeekday(day)}
                                            style={{
                                                background: excluded ? '#1e293b' : '#1e3a2f',
                                                border: excluded ? '2px solid #475569' : '2px solid #10b981',
                                                color: excluded ? '#94a3b8' : '#a7f3d0',
                                                borderRadius: '999px',
                                                padding: '0.3rem 0.7rem',
                                                fontSize: '0.82rem',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {excluded ? '✗' : '✓'} {label}
                                        </button>
                                    )
                                })}
                            </div>

                            {group.cadence_unit === 'month' ? (
                                <>
                                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                        Send the poll on this day of the month before (1–27)
                                    </label>
                                    <select
                                        className="input-field"
                                        value={schedDraft.sendDay}
                                        onChange={(e) => setSchedDraft((prev) => ({ ...prev, sendDay: e.target.value }))}
                                        style={{ maxWidth: '120px', marginBottom: '0.35rem' }}
                                    >
                                        {Array.from({ length: 27 }, (_, i) => i + 1).map((day) => (
                                            <option key={day} value={String(day)}>{day}</option>
                                        ))}
                                    </select>
                                    <p style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: '1rem' }}>
                                        Each poll offers the whole month — the &quot;around the&quot; day on your cadence
                                        guides when the hangout lands, not when the poll is sent.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                        Send the poll this many days before each period (2–60)
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                                        <input
                                            type="number"
                                            min="2"
                                            max="60"
                                            className="input-field"
                                            value={schedDraft.leadDays}
                                            onChange={(e) => setSchedDraft((prev) => ({ ...prev, leadDays: e.target.value }))}
                                            style={{ maxWidth: '120px', marginBottom: 0 }}
                                        />
                                        {schedPreview?.occurrences && (
                                            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                                                → sent on <strong style={{ color: '#c7d2fe' }}>{weekdayName(schedPreview.occurrences[1].sendOn)}s</strong>
                                            </span>
                                        )}
                                    </div>
                                </>
                            )}

                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                Days members get to respond
                                {(() => {
                                    const cap = maxDeadlineDays(group, {
                                        sendDayOfMonth: Number(schedDraft.sendDay),
                                        leadDays: Number(schedDraft.leadDays),
                                    })
                                    return cap ? ` (max ${cap} so the poll closes before the period starts)` : ''
                                })()}
                            </label>
                            <input
                                type="number"
                                min="1"
                                className="input-field"
                                value={schedDraft.deadlineDays}
                                onChange={(e) => setSchedDraft((prev) => ({ ...prev, deadlineDays: e.target.value }))}
                                style={{ maxWidth: '120px' }}
                            />

                            {schedPreview && <SchedulePreview group={group} preview={schedPreview} />}

                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                Email you at *
                            </label>
                            <input
                                type="email"
                                className="input-field"
                                placeholder="you@example.com"
                                value={schedDraft.notifyEmail}
                                onChange={(e) => setSchedDraft((prev) => ({ ...prev, notifyEmail: e.target.value }))}
                                style={{ maxWidth: '320px' }}
                            />

                            {/* Auto-scheduling opt-in. The cron acts on the owner's
                                Google account, so it needs a Google-mode group and a
                                stored refresh token (minted at sign-in). */}
                            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', padding: '0.9rem 1rem', marginBottom: '1rem' }}>
                                <p style={{ color: '#e2e8f0', fontSize: '0.9rem', marginBottom: '0.35rem' }}>⚡ Automatic scheduling</p>
                                <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: '0.6rem' }}>
                                    The day after your poll summary, the app picks the best date, creates the
                                    Google Calendar event from your account, and sends the invites for you.
                                </p>

                                {group.access_mode !== 'google' ? (
                                    <p style={{ color: '#64748b', fontSize: '0.82rem' }}>
                                        Not available for link-managed groups — automatic scheduling needs a
                                        Google-signed-in owner to create the calendar event as.
                                    </p>
                                ) : !ownerCalendar?.connected ? (
                                    <p style={{ color: '#fbbf24', fontSize: '0.82rem' }}>
                                        Connect your Google account first: sign out of the app and sign in with
                                        Google again, then come back to enable this.
                                    </p>
                                ) : (
                                    <>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#cbd5e1', fontSize: '0.88rem', cursor: 'pointer', marginBottom: schedDraft.autoEnabled ? '0.75rem' : 0 }}>
                                            <input
                                                type="checkbox"
                                                checked={schedDraft.autoEnabled}
                                                onChange={(e) => setSchedDraft((prev) => ({ ...prev, autoEnabled: e.target.checked }))}
                                            />
                                            Automatically schedule the hangout and send calendar invites
                                        </label>

                                        {schedDraft.autoEnabled && (
                                            <>
                                                {tokenLikelyStale && (
                                                    <p style={{ color: '#fbbf24', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
                                                        ⚠️ Your Google connection is over 7 days old and may have expired —
                                                        sign in again if auto-scheduling reports a connection problem.
                                                    </p>
                                                )}
                                                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                                    <div>
                                                        <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.25rem' }}>
                                                            Event start time
                                                        </label>
                                                        <input
                                                            type="time"
                                                            className="input-field"
                                                            value={schedDraft.autoTime}
                                                            onChange={(e) => setSchedDraft((prev) => ({ ...prev, autoTime: e.target.value }))}
                                                            style={{ maxWidth: '140px', marginBottom: 0 }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.25rem' }}>
                                                            Timezone
                                                        </label>
                                                        <select
                                                            className="input-field"
                                                            value={schedDraft.autoTimezone}
                                                            onChange={(e) => setSchedDraft((prev) => ({ ...prev, autoTimezone: e.target.value }))}
                                                            style={{ maxWidth: '240px', marginBottom: 0 }}
                                                        >
                                                            {!timezones.includes(schedDraft.autoTimezone) && (
                                                                <option value={schedDraft.autoTimezone}>{schedDraft.autoTimezone}</option>
                                                            )}
                                                            {timezones.map((tz) => (
                                                                <option key={tz} value={tz}>{tz}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.25rem' }}>
                                                    Send the calendar invite to
                                                </label>
                                                <select
                                                    className="input-field"
                                                    value={schedDraft.autoScope}
                                                    onChange={(e) => setSchedDraft((prev) => ({ ...prev, autoScope: e.target.value }))}
                                                    style={{ maxWidth: '320px', marginBottom: '0.35rem' }}
                                                >
                                                    {AUTO_INVITE_SCOPES.map((scope) => (
                                                        <option key={scope} value={scope}>{AUTO_INVITE_SCOPE_LABELS[scope]}</option>
                                                    ))}
                                                </select>
                                                <p style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 0 }}>
                                                    Only people with an email in the system can be invited — the
                                                    confirmation email lists exactly who was and wasn&apos;t, and why.
                                                </p>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button className="button-primary" disabled={schedSaving} onClick={saveSchedule}>
                                    {schedSaving ? 'Saving...' : 'Save automatic polls'}
                                </button>
                                <button className="button-secondary" onClick={() => setEditingSchedule(false)}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Roster */}
                <div className="section-card" style={{ marginTop: '1.25rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Members</h2>
                    <p style={{ color: '#94a3b8', marginBottom: '0.9rem' }}>
                        Members with an email get their personal link automatically when you plan a hangout.
                        The score weighs recent attendance more (90-day half-life).
                    </p>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <input
                            type="text"
                            className="input-field"
                            placeholder="Name *"
                            value={addName}
                            onChange={(e) => setAddName(e.target.value)}
                            style={{ marginBottom: 0, flex: '1 1 180px' }}
                        />
                        <input
                            type="email"
                            className="input-field"
                            placeholder="Email (optional)"
                            value={addEmail}
                            onChange={(e) => setAddEmail(e.target.value)}
                            style={{ marginBottom: 0, flex: '1 1 220px' }}
                        />
                        <button
                            className="button-primary"
                            disabled={addLoading}
                            onClick={async () => {
                                if (!addName.trim()) return
                                setAddLoading(true)
                                const ok = await post('add_member', {
                                    displayName: addName,
                                    email: addEmail.trim() || null,
                                })
                                if (ok) {
                                    setAddName('')
                                    setAddEmail('')
                                }
                                setAddLoading(false)
                            }}
                        >
                            {addLoading ? 'Adding...' : 'Add member'}
                        </button>
                    </div>

                    {members.length === 0 ? (
                        <div className="no-responses" style={{ padding: '1rem 0 0.25rem' }}>
                            <p>No members yet — add your crew above.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.6rem' }}>
                            {members.map((member) => (
                                <div key={member.id} className="person-card" style={{ border: '1px solid rgba(148, 163, 184, 0.14)' }}>
                                    {editingMemberId === member.id ? (
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                            <input
                                                type="text"
                                                className="input-field"
                                                value={editMemberName}
                                                onChange={(e) => setEditMemberName(e.target.value)}
                                                style={{ marginBottom: 0, flex: '1 1 160px' }}
                                            />
                                            <input
                                                type="email"
                                                className="input-field"
                                                placeholder="Add email"
                                                value={editMemberEmail}
                                                onChange={(e) => setEditMemberEmail(e.target.value)}
                                                style={{ marginBottom: 0, flex: '1 1 200px' }}
                                            />
                                            <button className="button-primary" onClick={() => saveMemberEdit(member)}>Save</button>
                                            <button className="button-secondary" onClick={() => setEditingMemberId(null)}>Cancel</button>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                            <div style={{ minWidth: '180px' }}>
                                                <h3 style={{ marginBottom: '0.15rem' }}>{member.display_name}</h3>
                                                <p style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                                    {member.invited_email || 'No email — share their personal link instead'}
                                                </p>
                                            </div>

                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div style={{ background: '#312e81', padding: '0.3rem 0.6rem', borderRadius: '999px', color: '#c7d2fe', fontSize: '0.8rem' }} title="Recency-weighted attendance score (90-day half-life)">
                                                    ⭐ {member.score.toFixed(2)}
                                                </div>
                                                <div style={{ background: '#1e3a2f', padding: '0.3rem 0.6rem', borderRadius: '999px', color: '#a7f3d0', fontSize: '0.8rem' }} title="Hangouts attended (unweighted)">
                                                    ✅ {member.attendedCount}
                                                </div>
                                                <button
                                                    className="button-secondary"
                                                    onClick={() => startEditMember(member)}
                                                >
                                                    Edit
                                                </button>
                                                {removingMemberId === member.id ? (
                                                    <>
                                                        <button
                                                            className="button-secondary"
                                                            style={{ borderColor: '#ef4444', color: '#fca5a5' }}
                                                            onClick={async () => {
                                                                await post('remove_member', { memberId: member.id })
                                                                setRemovingMemberId(null)
                                                            }}
                                                        >
                                                            Confirm remove
                                                        </button>
                                                        <button className="button-secondary" onClick={() => setRemovingMemberId(null)}>
                                                            Keep
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button className="button-secondary" onClick={() => setRemovingMemberId(member.id)}>
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Events */}
                <div className="section-card" style={{ marginTop: '1rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Group hangouts</h2>
                    <p style={{ color: '#94a3b8', marginBottom: '0.9rem' }}>
                        Events planned through this group. Once a date is picked (hosting round) and passes, attendance counts toward scores.
                    </p>

                    {events.length === 0 ? (
                        <div className="no-responses" style={{ padding: '1rem 0 0.25rem' }}>
                            <p>No hangouts yet.</p>
                            <Link href={planHref} className="nav-link" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
                                ➕ Plan the first one
                            </Link>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.75rem' }}>
                            {events.map((event) => {
                                const draft = linkDrafts[event.id] || { memberId: '', responseId: '' }
                                return (
                                    <div key={event.id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', padding: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                                            <div>
                                                <h3 style={{ marginBottom: '0.2rem' }}>📅 {event.title}</h3>
                                                <p style={{ color: '#64748b', fontSize: '0.82rem' }}>
                                                    {event.selected_date
                                                        ? `Date: ${formatDate(event.selected_date)}`
                                                        : `Respond by ${formatDate(event.response_deadline)}`}
                                                    {event.countable ? ' · counts toward scores' : ''}
                                                </p>
                                            </div>
                                            <Link href={`/respond/${event.slug}`} className="nav-link">
                                                Open event →
                                            </Link>
                                        </div>

                                        {/* Per-member personal links */}
                                        {members.length > 0 && (
                                            <details style={{ marginTop: '0.6rem' }}>
                                                <summary style={{ color: '#94a3b8', fontSize: '0.85rem', cursor: 'pointer' }}>
                                                    Personal links for this event
                                                </summary>
                                                <div style={{ display: 'grid', gap: '0.35rem', marginTop: '0.5rem' }}>
                                                    {members.map((member) => (
                                                        <div key={member.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                            <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>{member.display_name}</span>
                                                            <button
                                                                className="button-secondary"
                                                                onClick={() => copyToClipboard(
                                                                    `${window.location.origin}/respond/${event.slug}?m=${member.member_token}`,
                                                                    `${event.id}-${member.id}`
                                                                )}
                                                            >
                                                                {copied === `${event.id}-${member.id}` ? 'Copied!' : 'Copy their link'}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        )}

                                        {/* Attendance (past events with a picked date) */}
                                        {event.countable && members.length > 0 && (
                                            <div style={{ marginTop: '0.75rem' }}>
                                                <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                                    Attendance (tap to correct; &quot;auto&quot; comes from their response):
                                                </p>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                    {members.map((member) => {
                                                        const cell = event.attendance?.[member.id]
                                                        const attended = Boolean(cell?.attended)
                                                        const overridden = cell?.override !== null && cell?.override !== undefined
                                                        return (
                                                            <button
                                                                key={member.id}
                                                                onClick={() => cycleAttendance(event, member)}
                                                                title={overridden ? 'Set by host — tap to flip' : 'Auto from response — tap to override'}
                                                                style={{
                                                                    background: attended ? '#1e3a2f' : '#1e293b',
                                                                    border: attended ? '2px solid #10b981' : '2px solid #475569',
                                                                    color: attended ? '#a7f3d0' : '#94a3b8',
                                                                    borderRadius: '999px',
                                                                    padding: '0.3rem 0.7rem',
                                                                    fontSize: '0.82rem',
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                {attended ? '✓' : '✗'} {member.display_name}
                                                                <span style={{ opacity: 0.65, marginLeft: '0.3rem', fontSize: '0.72rem' }}>
                                                                    {overridden ? 'set' : 'auto'}
                                                                </span>
                                                            </button>
                                                        )
                                                    })}
                                                </div>

                                                {/* Link an anonymous response to a member */}
                                                {event.responses.length > 0 && (
                                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem', alignItems: 'center' }}>
                                                        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Link a response:</span>
                                                        <select
                                                            className="input-field"
                                                            value={draft.responseId}
                                                            onChange={(e) => setLinkDrafts((prev) => ({ ...prev, [event.id]: { ...draft, responseId: e.target.value } }))}
                                                            style={{ marginBottom: 0, maxWidth: '180px', fontSize: '0.82rem' }}
                                                        >
                                                            <option value="">— response —</option>
                                                            {event.responses.map((response) => (
                                                                <option key={response.id} value={response.id}>{response.display_name}</option>
                                                            ))}
                                                        </select>
                                                        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>counts as</span>
                                                        <select
                                                            className="input-field"
                                                            value={draft.memberId}
                                                            onChange={(e) => setLinkDrafts((prev) => ({ ...prev, [event.id]: { ...draft, memberId: e.target.value } }))}
                                                            style={{ marginBottom: 0, maxWidth: '180px', fontSize: '0.82rem' }}
                                                        >
                                                            <option value="">— member —</option>
                                                            {members.map((member) => (
                                                                <option key={member.id} value={member.id}>{member.display_name}</option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            className="button-secondary"
                                                            disabled={!draft.memberId || !draft.responseId}
                                                            onClick={async () => {
                                                                const ok = await post('link_response', {
                                                                    eventId: event.id,
                                                                    memberId: draft.memberId,
                                                                    responseId: draft.responseId,
                                                                })
                                                                if (ok) setLinkDrafts((prev) => ({ ...prev, [event.id]: { memberId: '', responseId: '' } }))
                                                            }}
                                                        >
                                                            Link
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
