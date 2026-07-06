'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAdmin } from '../layout'
import { getAttendeeWeight } from '../../../lib/attendance'

export default function EventsListPage() {
    const admin = useAdmin()
    const adminPassword = admin?.adminPassword
    const [events, setEvents] = useState([])
    const [loading, setLoading] = useState(true)
    const [unlinked, setUnlinked] = useState(null)
    const [unlinkedOpen, setUnlinkedOpen] = useState(false)

    const fetchData = useCallback(async () => {
        try {
            const [eventsRes, unlinkedRes] = await Promise.all([
                fetch('/api/admin/events', {
                    headers: { 'x-admin-password': adminPassword || '' },
                }),
                fetch('/api/admin/unlinked', {
                    headers: { 'x-admin-password': adminPassword || '' },
                }),
            ])
            const data = eventsRes.ok ? await eventsRes.json() : null
            setEvents(data?.events || [])
            setUnlinked(unlinkedRes.ok ? await unlinkedRes.json() : null)
        } catch {
            setEvents([])
            setUnlinked(null)
        }
        setLoading(false)
    }, [adminPassword])

    useEffect(() => {
        const timeoutId = setTimeout(fetchData, 0)
        return () => clearTimeout(timeoutId)
    }, [fetchData])

    const handleRefresh = () => {
        setLoading(true)
        fetchData()
    }

    const getShareUrl = (slug) => {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/respond/${slug}`
        }
        return `/respond/${slug}`
    }

    const copyLink = (slug) => {
        navigator.clipboard.writeText(getShareUrl(slug))
    }

    if (loading) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h2>Loading events...</h2>
            </div>
        )
    }

    return (
        <div className="container">
            <Link href="/admin" className="nav-link">← Back to Admin</Link>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                <h1>📋 Your Events</h1>
                <button
                    onClick={handleRefresh}
                    style={{
                        background: '#334155', color: '#e2e8f0', border: 'none',
                        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                    }}
                >
                    🔄 Refresh
                </button>
            </div>

            <h2>{events.length} event{events.length !== 1 ? 's' : ''}</h2>

            {events.length === 0 ? (
                <div className="no-responses" style={{ marginTop: '2rem' }}>
                    <p>No events yet.</p>
                    <Link href="/admin/create" className="nav-link" style={{ display: 'block', marginTop: '1rem' }}>
                        ➕ Create your first event
                    </Link>
                </div>
            ) : (
                events.map(event => {
                    const eventResponses = event.responses || []
                    const confirmedAttendees = eventResponses
                        .filter(r => r.confirmed)
                        .reduce((sum, r) => sum + getAttendeeWeight(r), 0)
                    const totalAttendees = eventResponses
                        .reduce((sum, r) => sum + getAttendeeWeight(r), 0)

                    return (
                        <Link
                            key={event.id}
                            href={`/admin/events/${event.id}`}
                            style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                            <div className="person-card" style={{ cursor: 'pointer' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <h3 style={{ marginBottom: '0.25rem' }}>📅 {event.title}</h3>
                                        {event.description && (
                                            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                                                {event.description}
                                            </p>
                                        )}
                                        <p style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                            {new Date(event.date_range_start + 'T12:00:00').toLocaleDateString('en-US', {
                                                month: 'short', day: 'numeric'
                                            })}
                                            {' → '}
                                            {new Date(event.date_range_end + 'T12:00:00').toLocaleDateString('en-US', {
                                                month: 'short', day: 'numeric', year: 'numeric'
                                            })}
                                        </p>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{
                                            background: '#1e3a2f', padding: '0.3rem 0.6rem',
                                            borderRadius: '6px', fontSize: '0.8rem', color: '#94a3b8'
                                        }}>
                                            {confirmedAttendees}/{totalAttendees} attendees
                                        </div>
                                    </div>
                                </div>

                                <div style={{
                                    marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem'
                                }}>
                                    <span style={{ color: '#6366f1', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                                        /respond/{event.slug}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            copyLink(event.slug)
                                        }}
                                        style={{
                                            background: '#334155', color: '#e2e8f0', border: 'none',
                                            padding: '0.25rem 0.5rem', borderRadius: '6px',
                                            cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap'
                                        }}
                                    >
                                        📋 Copy
                                    </button>
                                </div>
                            </div>
                        </Link>
                    )
                })
            )}

            {unlinked && (() => {
                const unlinkedTotal =
                    (unlinked.unlinkedOwnerships?.length || 0) +
                    (unlinked.unlinkedEmailResponses?.length || 0)

                return (
                    <div style={{
                        marginTop: '2rem', background: '#1e293b', borderRadius: '8px',
                        border: '1px solid #334155', padding: '0.75rem 1rem'
                    }}>
                        <button
                            onClick={() => setUnlinkedOpen(open => !open)}
                            style={{
                                background: 'none', border: 'none', color: '#94a3b8',
                                cursor: 'pointer', fontSize: '0.85rem', padding: 0,
                                display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%'
                            }}
                        >
                            <span>{unlinkedOpen ? '▾' : '▸'}</span>
                            <span>
                                Unlinked identities ({unlinkedTotal})
                                {unlinked.unclaimedGuestCount > 0 && (
                                    <span style={{ color: '#64748b' }}>
                                        {' '}· {unlinked.unclaimedGuestCount} unclaimed guest response{unlinked.unclaimedGuestCount !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </span>
                        </button>

                        {unlinkedOpen && (
                            <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                                <p style={{ color: '#64748b', marginBottom: '0.75rem' }}>
                                    Rows the participants backfill hasn&apos;t linked. Re-run 004 after deploys;
                                    hand-check anything left here before running 005.
                                </p>

                                <h4 style={{ color: '#e2e8f0', marginBottom: '0.25rem' }}>
                                    Ownerships ({unlinked.unlinkedOwnerships?.length || 0})
                                </h4>
                                {(unlinked.unlinkedOwnerships || []).length === 0 ? (
                                    <p style={{ marginBottom: '0.75rem' }}>None 🎉</p>
                                ) : (
                                    <ul style={{ listStyle: 'none', marginBottom: '0.75rem' }}>
                                        {unlinked.unlinkedOwnerships.map(row => (
                                            <li key={row.id} style={{ padding: '0.25rem 0', borderBottom: '1px solid #334155' }}>
                                                <span style={{ color: '#e2e8f0' }}>{row.event_title || row.event_id}</span>
                                                {' — '}{row.access_mode}
                                                {row.owner_email ? ` · ${row.owner_email}` : ''}
                                                {!row.owner_email && row.owner_user_id ? ` · user_id ${row.owner_user_id}` : ''}
                                                {!row.owner_email && !row.owner_user_id ? ' · link-only (fine)' : ''}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <h4 style={{ color: '#e2e8f0', marginBottom: '0.25rem' }}>
                                    Responses with email ({unlinked.unlinkedEmailResponses?.length || 0})
                                </h4>
                                {(unlinked.unlinkedEmailResponses || []).length === 0 ? (
                                    <p>None 🎉</p>
                                ) : (
                                    <ul style={{ listStyle: 'none' }}>
                                        {unlinked.unlinkedEmailResponses.map(row => (
                                            <li key={row.id} style={{ padding: '0.25rem 0', borderBottom: '1px solid #334155' }}>
                                                <span style={{ color: '#e2e8f0' }}>{row.display_name}</span>
                                                {' · '}{row.google_email}
                                                {' — '}{row.event_title || row.event_id}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                )
            })()}
        </div>
    )
}
