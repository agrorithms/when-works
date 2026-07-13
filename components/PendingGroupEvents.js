'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const PARTICIPANT_TOKEN_KEY = 'when_works_participant_token'

// "Group events awaiting your response" banner (home + events dashboard).
// Fetch-on-load, no polling, no dismiss state — items disappear once the
// visitor responds or the deadline passes. Renders nothing when empty.
export default function PendingGroupEvents() {
    const [pending, setPending] = useState([])

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            try {
                const participantToken = typeof window !== 'undefined'
                    ? localStorage.getItem(PARTICIPANT_TOKEN_KEY) || null
                    : null

                const res = await fetch('/api/me/pending', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ participantToken }),
                })
                if (!res.ok) return
                const data = await res.json()
                if (!cancelled) setPending(data.pending || [])
            } catch {
                // Banner is best-effort; stay hidden on failure.
            }
        }

        load()
        return () => { cancelled = true }
    }, [])

    if (pending.length === 0) return null

    return (
        <div style={{
            background: '#312e81',
            border: '2px solid #6366f1',
            borderRadius: '12px',
            padding: '0.9rem 1rem',
            marginBottom: '1.1rem',
        }}>
            <p style={{ color: '#c7d2fe', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                👥 Your group{pending.length !== 1 ? 's are' : ' is'} planning — pick your dates:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {pending.map((item) => (
                    <Link
                        key={item.slug}
                        href={item.memberToken ? `/respond/${item.slug}?m=${item.memberToken}` : `/respond/${item.slug}`}
                        style={{
                            color: '#e0e7ff',
                            textDecoration: 'none',
                            background: 'rgba(15, 23, 42, 0.55)',
                            borderRadius: '8px',
                            padding: '0.5rem 0.7rem',
                            fontSize: '0.9rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            flexWrap: 'wrap',
                        }}
                    >
                        <span><strong>{item.eventTitle}</strong> · {item.groupName}</span>
                        <span style={{ color: '#a5b4fc', fontSize: '0.8rem' }}>
                            respond by {new Date(item.responseDeadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} →
                        </span>
                    </Link>
                ))}
            </div>
        </div>
    )
}
