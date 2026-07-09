'use client'

// Landing page for the pause link in the pre-send notice email. Pausing only
// happens on the button POST — email scanners prefetching the GET must never
// mutate anything.

import Link from 'next/link'
import { useState } from 'react'
import { useParams } from 'next/navigation'

export default function PauseSchedulePage() {
    const params = useParams()
    const token = params.token

    const [state, setState] = useState('confirm') // confirm | working | done | error
    const [groupName, setGroupName] = useState('')
    const [error, setError] = useState('')

    const pause = async () => {
        setState('working')
        try {
            const res = await fetch('/api/groups/pause', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setError(data.error || 'Something went wrong.')
                setState('error')
                return
            }
            setGroupName(data.groupName || '')
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
                        <button
                            className="submit-btn"
                            style={{ marginTop: '1.5rem', maxWidth: '280px' }}
                            disabled={state === 'working'}
                            onClick={pause}
                        >
                            {state === 'working' ? 'Pausing...' : 'Pause automatic polls'}
                        </button>
                    </>
                )}
                <Link href="/groups" className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    ← My groups
                </Link>
            </div>
        </div>
    )
}
