'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import Link from 'next/link'

export default function EventsListPage() {
    const [events, setEvents] = useState([])
    const [responses, setResponses] = useState([])
    const [loading, setLoading] = useState(true)

    const fetchData = useCallback(async () => {
        const { data: eventsData } = await supabase
            .from('events')
            .select('*')
            .order('created_at', { ascending: false })

        const { data: responsesData } = await supabase
            .from('responses')
            .select('id, event_id, confirmed, includes_so')

        setEvents(eventsData || [])
        setResponses(responsesData || [])
        setLoading(false)
    }, [])

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

    const getAttendeeWeight = (response) => response.includes_so ? 2 : 1

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
                    const eventResponses = responses.filter(r => r.event_id === event.id)
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
        </div>
    )
}
