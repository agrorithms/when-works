'use client'

// Landing page for the pause link in the pre-send notice email. Pausing only
// happens on the button POST — email scanners prefetching the GET must never
// mutate anything. When a calendar-event generation is pending (auto-
// scheduling stamped for tomorrow), the owner chooses whether pausing also
// cancels it or lets it happen first.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

function formatDate(dateStr) {
    if (!dateStr) return ''
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
}

export default function PauseSchedulePage() {
    const params = useParams()
    const token = params.token

    const [state, setState] = useState('confirm') // confirm | working | done | error
    const [groupName, setGroupName] = useState('')
    const [pending, setPending] = useState(null)
    const [cancelledPending, setCancelledPending] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        // Read-only lookup so the confirm screen can offer the right buttons.
        const inspect = async () => {
            try {
                const res = await fetch('/api/groups/pause', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, action: 'inspect' }),
                })
                const data = await res.json().catch(() => ({}))
                if (res.ok) {
                    setGroupName(data.groupName || '')
                    setPending(data.pendingGeneration || null)
                }
            } catch {
                // Non-fatal: the plain pause button still works.
            }
        }
        inspect()
    }, [token])

    const pause = async (cancelPendingGeneration) => {
        setState('working')
        try {
            const res = await fetch('/api/groups/pause', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, cancelPendingGeneration }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setError(data.error || 'Something went wrong.')
                setState('error')
                return
            }
            setGroupName(data.groupName || '')
            setCancelledPending(cancelPendingGeneration)
            setState('done')
        } catch {
            setError('Something went wrong. Please try again.')
            setState('error')
        }
    }

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a' }}>
            <div className="container" style={{ paddingTop: '4rem', textAlign: 'center', maxWidth: '480px' }}>
                {state === 'done' ? (
                    <>
                        <h1>⏸️</h1>
                        <h1>Automatic polls paused</h1>
                        <p style={{ color: '#94a3b8', marginTop: '0.75rem' }}>
                            {groupName ? `No more polls will be sent for ${groupName}` : 'No more polls will be sent'} until you resume from the group page.
                        </p>
                        {pending && (
                            <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>
                                {cancelledPending
                                    ? `The calendar event for "${pending.title}" will NOT be created automatically.`
                                    : `The calendar event for "${pending.title}" will still be created on ${formatDate(pending.scheduledFor)}.`}
                            </p>
                        )}
                    </>
                ) : state === 'error' ? (
                    <>
                        <h1>😕</h1>
                        <h1>Couldn&apos;t pause</h1>
                        <p style={{ color: '#fca5a5', marginTop: '0.75rem' }}>{error}</p>
                    </>
                ) : (
                    <>
                        <h1>⏸️</h1>
                        <h1>Pause automatic polls?</h1>
                        <p style={{ color: '#94a3b8', marginTop: '0.75rem' }}>
                            The app will stop creating and emailing new polls for this group until you resume.
                        </p>
                        {pending ? (
                            <>
                                <p style={{ color: '#c7d2fe', marginTop: '0.75rem' }}>
                                    ⚡ A Google Calendar event for <strong>{pending.title}</strong> is set to be created
                                    automatically on {formatDate(pending.scheduledFor)}. Should it still happen?
                                </p>
                                <button
                                    className="submit-btn"
                                    style={{ marginTop: '1.5rem', maxWidth: '320px' }}
                                    disabled={state === 'working'}
                                    onClick={() => pause(true)}
                                >
                                    {state === 'working' ? 'Pausing...' : 'Pause and cancel the calendar event'}
                                </button>
                                <button
                                    className="button-secondary"
                                    style={{ marginTop: '0.75rem', maxWidth: '320px', display: 'inline-block' }}
                                    disabled={state === 'working'}
                                    onClick={() => pause(false)}
                                >
                                    Let the event be created, then pause
                                </button>
                            </>
                        ) : (
                            <button
                                className="submit-btn"
                                style={{ marginTop: '1.5rem', maxWidth: '280px' }}
                                disabled={state === 'working'}
                                onClick={() => pause(false)}
                            >
                                {state === 'working' ? 'Pausing...' : 'Pause automatic polls'}
                            </button>
                        )}
                    </>
                )}
                <Link href="/groups" className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    ← My groups
                </Link>
            </div>
        </div>
    )
}
