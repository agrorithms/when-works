'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import Link from 'next/link'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function EventDetailPage() {
    const params = useParams()
    const eventId = params.id

    const [event, setEvent] = useState(null)
    const [responses, setResponses] = useState([])
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)

    const [tab, setTab] = useState('overview')
    const [showUnconfirmed, setShowUnconfirmed] = useState(false)

    useEffect(() => {
        fetchData()
    }, [eventId])

    const fetchData = async () => {
        setLoading(true)

        const { data: eventData, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .limit(1)

        if (eventError || !eventData || eventData.length === 0) {
            setNotFound(true)
            setLoading(false)
            return
        }

        const { data: responsesData } = await supabase
            .from('responses')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: true })

        setEvent(eventData[0])
        setResponses(responsesData || [])
        setLoading(false)
    }

    const getShareUrl = (slug) => {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/respond/${slug}`
        }
        return `/respond/${slug}`
    }

    const copyLink = () => {
        if (event) {
            navigator.clipboard.writeText(getShareUrl(event.slug))
        }
    }

    const getFilteredResponses = () => {
        return showUnconfirmed ? responses : responses.filter(r => r.confirmed)
    }

    const getAttendeeWeight = (response) => response.includes_so ? 2 : 1

    const getAvailabilityForDate = (dateStr) => {
        const filtered = getFilteredResponses()
        const available = []
        const unavailable = []
        let availableCount = 0
        let unavailableCount = 0

        filtered.forEach(r => {
            const weight = getAttendeeWeight(r)
            const label = r.includes_so ? `${r.display_name} (+SO)` : r.display_name
            if (r.response_type === 'available') {
                if (r.dates.includes(dateStr)) {
                    available.push(label)
                    availableCount += weight
                } else {
                    unavailable.push(label)
                    unavailableCount += weight
                }
            } else {
                if (r.dates.includes(dateStr)) {
                    unavailable.push(label)
                    unavailableCount += weight
                } else {
                    available.push(label)
                    availableCount += weight
                }
            }
        })

        return { available, unavailable, availableCount, unavailableCount }
    }

    const getMonthsInRange = () => {
        if (!event) return []

        const start = new Date(event.date_range_start + 'T12:00:00')
        const end = new Date(event.date_range_end + 'T12:00:00')
        const months = []

        let current = new Date(start.getFullYear(), start.getMonth(), 1)
        const last = new Date(end.getFullYear(), end.getMonth(), 1)

        while (current <= last) {
            months.push({ year: current.getFullYear(), month: current.getMonth() })
            current = new Date(current.getFullYear(), current.getMonth() + 1, 1)
        }

        return months
    }

    const getBestDates = () => {
        if (!event) return []
        const filtered = getFilteredResponses()
        const totalAttendees = filtered.reduce((sum, r) => sum + getAttendeeWeight(r), 0)
        const results = []

        const start = new Date(event.date_range_start + 'T12:00:00')
        const end = new Date(event.date_range_end + 'T12:00:00')
        const blocked = event.blocked_dates || []

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0]
            if (blocked.includes(dateStr)) continue

            const { available, availableCount } = getAvailabilityForDate(dateStr)
            results.push({ date: dateStr, count: availableCount, available, totalAttendees })
        }

        return results.sort((a, b) => b.count - a.count)
    }

    const isInEventRange = (dateStr) => {
        if (!event) return false
        return dateStr >= event.date_range_start && dateStr <= event.date_range_end
    }

    const isBlocked = (dateStr) => {
        if (!event) return false
        return (event.blocked_dates || []).includes(dateStr)
    }

    const formatDate = (year, month, day) => {
        const m = String(month + 1).padStart(2, '0')
        const d = String(day).padStart(2, '0')
        return `${year}-${m}-${d}`
    }

    if (loading) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h2>Loading event...</h2>
            </div>
        )
    }

    if (notFound) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h1>😕</h1>
                <h1>Event Not Found</h1>
                <Link href="/admin/events" className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    ← Back to Events
                </Link>
            </div>
        )
    }

    const filteredResponses = getFilteredResponses()
    const totalPeople = filteredResponses.reduce((sum, r) => sum + getAttendeeWeight(r), 0)
    const confirmedCount = responses.filter(r => r.confirmed).reduce((sum, r) => sum + getAttendeeWeight(r), 0)
    const unconfirmedCount = responses.filter(r => !r.confirmed).reduce((sum, r) => sum + getAttendeeWeight(r), 0)
    const months = getMonthsInRange()

    return (
        <div className="container">
            <Link href="/admin/events" className="nav-link">← Back to Events</Link>

            <h1 style={{ marginTop: '1rem' }}>📅 {event.title}</h1>
            {event.description && (
                <p style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>{event.description}</p>
            )}
            <h2>{confirmedCount} confirmed attendees, {unconfirmedCount} in-progress attendees</h2>

            {/* Share link */}
            <div style={{
                background: '#1e293b', borderRadius: '10px', padding: '1rem', marginBottom: '1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem'
            }}>
                <div style={{ overflow: 'hidden' }}>
                    <p style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        Share this link with friends:
                    </p>
                    <p style={{ color: '#6366f1', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                        {getShareUrl(event.slug)}
                    </p>
                </div>
                <button
                    onClick={copyLink}
                    style={{
                        background: '#6366f1', color: 'white', border: 'none',
                        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer',
                        fontSize: '0.85rem', whiteSpace: 'nowrap'
                    }}
                >
                    📋 Copy
                </button>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <button
                    onClick={fetchData}
                    style={{
                        background: '#334155', color: '#e2e8f0', border: 'none',
                        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                    }}
                >
                    🔄 Refresh
                </button>
                <button
                    onClick={() => setShowUnconfirmed(!showUnconfirmed)}
                    style={{
                        background: showUnconfirmed ? '#312e81' : '#1e293b',
                        color: showUnconfirmed ? '#c7d2fe' : '#94a3b8',
                        border: showUnconfirmed ? '2px solid #6366f1' : '2px solid #334155',
                        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                    }}
                >
                    {showUnconfirmed ? '👁️ Showing all' : '👁️ Confirmed only'}
                </button>
            </div>

            {filteredResponses.length === 0 ? (
                <div className="no-responses">
                    <p>No {showUnconfirmed ? '' : 'confirmed '}responses yet. Share the link!</p>
                </div>
            ) : (
                <>
                    {/* Tabs */}
                    <div className="tabs">
                        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
                            📊 Overview
                        </button>
                        <button className={tab === 'individual' ? 'active' : ''} onClick={() => setTab('individual')}>
                            👤 Individual
                        </button>
                        <button className={tab === 'best' ? 'active' : ''} onClick={() => setTab('best')}>
                            🏆 Best Dates
                        </button>
                    </div>

                    {/* Overview Tab — Stacked Months */}
                    {tab === 'overview' && (
                        <>
                            <div className="legend">
                                <span>
                                    <span className="legend-dot" style={{ background: '#065f46', border: '2px solid #10b981' }} />
                                    All
                                </span>
                                <span>
                                    <span className="legend-dot" style={{ background: '#1e3a2f' }} />
                                    Some
                                </span>
                                <span>
                                    <span className="legend-dot" style={{ background: '#1e293b' }} />
                                    None
                                </span>
                                <span>
                                    <span className="legend-dot" style={{ background: '#7f1d1d' }} />
                                    Blocked
                                </span>
                            </div>

                            {months.map(({ year, month }) => {
                                const daysInMonth = new Date(year, month + 1, 0).getDate()
                                const firstDay = new Date(year, month, 1).getDay()
                                const monthName = new Date(year, month, 1).toLocaleString('default', {
                                    month: 'long', year: 'numeric'
                                })

                                return (
                                    <div key={`${year}-${month}`} style={{ marginBottom: '2rem' }}>
                                        <h2 style={{
                                            color: '#f8fafc', fontWeight: 600, textAlign: 'center',
                                            marginBottom: '0.75rem', fontSize: '1.2rem'
                                        }}>
                                            {monthName}
                                        </h2>

                                        <div className="admin-grid">
                                            {DAYS.map(d => (
                                                <div key={d} className="day-label">{d}</div>
                                            ))}

                                            {Array.from({ length: firstDay }).map((_, i) => (
                                                <div key={`empty-${i}`} className="admin-day" style={{ background: 'transparent' }} />
                                            ))}

                                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                                const day = i + 1
                                                const dateStr = formatDate(year, month, day)
                                                const inRange = isInEventRange(dateStr)
                                                const blocked = isBlocked(dateStr)

                                                if (!inRange) {
                                                    return (
                                                        <div key={dateStr} className="admin-day" style={{ opacity: 0.15 }}>
                                                            <span className="date-num">{day}</span>
                                                        </div>
                                                    )
                                                }

                                                if (blocked) {
                                                    return (
                                                        <div key={dateStr} className="admin-day" style={{ background: '#7f1d1d' }}>
                                                            <span className="date-num">{day}</span>
                                                            <span className="count">🚫</span>
                                                        </div>
                                                    )
                                                }

                                                const { available, availableCount } = getAvailabilityForDate(dateStr)
                                                const count = availableCount

                                                let className = 'admin-day '
                                                if (count === totalPeople && totalPeople > 0) className += 'all-available'
                                                else if (count > 0) className += 'some-available'
                                                else className += 'none-available'

                                                return (
                                                    <div
                                                        key={dateStr}
                                                        className={className}
                                                        title={`Available: ${available.join(', ')}`}
                                                    >
                                                        <span className="date-num">{day}</span>
                                                        <span className="count">{count}/{totalPeople}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}

                            <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                                💡 Hover over a date to see who&apos;s available
                            </p>
                        </>
                    )}

                    {/* Individual Tab */}
                    {tab === 'individual' && (
                        <div>
                            {filteredResponses.map(r => (
                                <div key={r.id} className="person-card">
                                    <h3>
                                        {r.display_name}
                                        {r.includes_so && (
                                            <span style={{
                                                fontSize: '0.72rem',
                                                fontWeight: 500,
                                                marginLeft: '0.5rem',
                                                color: '#93c5fd'
                                            }}>
                                                + SO
                                            </span>
                                        )}
                                        <span style={{
                                            fontSize: '0.75rem', fontWeight: 400, marginLeft: '0.5rem',
                                            color: r.confirmed ? '#10b981' : '#f59e0b'
                                        }}>
                                            {r.confirmed ? '✅ Confirmed' : '⏳ In progress'}
                                        </span>
                                    </h3>
                                    <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>
                                        Marked {r.response_type} days:
                                    </p>
                                    <div>
                                        {r.dates && r.dates.sort().map(d => (
                                            <span key={d} className={`badge ${r.response_type}`}>
                                                {new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
                                                    month: 'short', day: 'numeric'
                                                })}
                                            </span>
                                        ))}
                                        {(!r.dates || r.dates.length === 0) && (
                                            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                                                No dates selected yet
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Best Dates Tab */}
                    {tab === 'best' && (
                        <div>
                            <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                Dates ranked by number of people available:
                            </p>
                            {getBestDates().filter(d => d.count > 0).slice(0, 15).map(d => (
                                <div key={d.date} className="person-card" style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <div>
                                        <strong style={{ color: '#f8fafc' }}>
                                            {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
                                                weekday: 'long', month: 'long', day: 'numeric'
                                            })}
                                        </strong>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                                            {d.available.join(', ')}
                                        </div>
                                    </div>
                                    <div style={{
                                        background: d.count === d.totalAttendees ? '#065f46' : '#1e3a2f',
                                        border: d.count === d.totalAttendees ? '2px solid #10b981' : 'none',
                                        padding: '0.4rem 0.8rem', borderRadius: '8px',
                                        fontWeight: 600, fontSize: '0.9rem',
                                        color: d.count === d.totalAttendees ? '#a7f3d0' : '#94a3b8'
                                    }}>
                                        {d.count}/{d.totalAttendees}
                                    </div>
                                </div>
                            ))}
                            {getBestDates().filter(d => d.count > 0).length === 0 && (
                                <p style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>
                                    No availability data yet.
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
