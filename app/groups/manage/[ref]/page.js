'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { saveGroupToken } from '../../../../lib/savedGroupTokens'

const CADENCE_OPTIONS = [
    { value: '', label: 'No set cadence' },
    { value: '7', label: 'Weekly' },
    { value: '14', label: 'Every 2 weeks' },
    { value: '30', label: 'Monthly' },
    { value: '60', label: 'Every 2 months' },
    { value: '90', label: 'Quarterly' },
]

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

// "Plan next hangout" prefill: title "<Group> — <Month Year>", range today →
// today + min(cadence ?? 21, 30 days).
function planNextHref(group, ref) {
    const today = getToday()
    const now = new Date()
    const title = `${group.name} — ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    const end = addDays(today, Math.min(group.cadence_days ?? 21, 30))
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

    const { group, members, events, nudge } = bundle
    const countableEvents = events.filter((event) => event.countable)
    const planHref = planNextHref(group, ref)

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
                                value={String(group.cadence_days ?? '')}
                                onChange={(e) => post('update_group', { cadence_days: e.target.value ? Number(e.target.value) : null })}
                                style={{ marginBottom: 0, maxWidth: '220px' }}
                            >
                                {CADENCE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
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

                {/* Cadence nudge */}
                {nudge?.nudge && (
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
