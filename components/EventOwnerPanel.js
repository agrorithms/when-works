'use client'

import Link from 'next/link'

function formatDate(value) {
    if (!value) return ''
    return new Date(value + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

function formatDateRange(event) {
    if (!event?.date_range_start || !event?.date_range_end) return ''
    return `${formatDate(event.date_range_start)} → ${formatDate(event.date_range_end)}`
}

export default function EventOwnerPanel({
    event,
    responses = [],
    publicLink,
    manageLink,
    accessLabel,
    backHref = '/events',
    backLabel = '← Back to Events',
}) {
    const confirmedResponses = responses.filter((response) => response.confirmed)
    const responseCount = responses.length
    const confirmedCount = confirmedResponses.length

    const copyToClipboard = async (value) => {
        if (!value || typeof navigator === 'undefined') return
        const resolved = value.startsWith('http') ? value : `${window.location.origin}${value}`
        await navigator.clipboard.writeText(resolved)
    }

    return (
        <div className="container" style={{ paddingTop: '2rem' }}>
            <Link href={backHref} className="nav-link">
                {backLabel}
            </Link>

            <div
                style={{
                    marginTop: '1rem',
                    background: 'linear-gradient(135deg, #1e293b 0%, #111827 100%)',
                    border: '1px solid #334155',
                    borderRadius: '18px',
                    padding: '1.25rem',
                    boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                            {accessLabel}
                        </p>
                        <h1 style={{ marginBottom: '0.35rem' }}>📅 {event.title}</h1>
                        {event.description && (
                            <p style={{ color: '#cbd5e1', maxWidth: '52rem' }}>{event.description}</p>
                        )}
                        <p style={{ color: '#94a3b8', marginTop: '0.75rem', fontSize: '0.9rem' }}>
                            {formatDateRange(event)}
                        </p>
                    </div>

                    <div
                        style={{
                            minWidth: '180px',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '14px',
                            padding: '0.9rem',
                        }}
                    >
                        <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Responses</p>
                        <p style={{ fontSize: '2rem', fontWeight: 700, color: '#f8fafc', lineHeight: 1.1 }}>
                            {responseCount}
                        </p>
                        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                            {confirmedCount} confirmed
                        </p>
                    </div>
                </div>

                <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1.15rem' }}>
                    {publicLink && (
                        <div
                            style={{
                                background: '#0f172a',
                                border: '1px solid #334155',
                                borderRadius: '12px',
                                padding: '0.95rem',
                            }}
                        >
                            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                                Public invite link
                            </p>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <p style={{ color: '#6366f1', wordBreak: 'break-all', flex: '1 1 320px' }}>
                                    {publicLink}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(publicLink)}
                                    className="button-secondary"
                                >
                                    Copy link
                                </button>
                            </div>
                        </div>
                    )}

                    {manageLink && (
                        <div
                            style={{
                                background: '#0f172a',
                                border: '1px solid #334155',
                                borderRadius: '12px',
                                padding: '0.95rem',
                            }}
                        >
                            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                                Private owner link
                            </p>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <p style={{ color: '#f8fafc', wordBreak: 'break-all', flex: '1 1 320px' }}>
                                    Save this link if you want browser-based access later.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(manageLink)}
                                    className="button-primary"
                                >
                                    Copy owner link
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="section-card" style={{ marginTop: '1rem' }}>
                <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Invite responses</h2>
                <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>
                    A quick snapshot of responses so you can manage the event without going into the admin area.
                </p>

                {responses.length === 0 ? (
                    <div className="no-responses" style={{ padding: '1.5rem 0' }}>
                        <p>No responses yet. Share the public link to start collecting availability.</p>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                        {responses.slice(0, 8).map((response) => (
                            <div
                                key={response.id}
                                style={{
                                    background: '#0f172a',
                                    border: '1px solid #334155',
                                    borderRadius: '12px',
                                    padding: '0.9rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: '1rem',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <div style={{ minWidth: '220px' }}>
                                    <h3 style={{ marginBottom: '0.25rem' }}>{response.display_name}</h3>
                                    <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                                        {response.response_type === 'available' ? 'Available' : 'Unavailable'}
                                        {response.includes_so ? ' · includes SO' : ''}
                                    </p>
                                </div>

                                <div style={{ color: '#cbd5e1', fontSize: '0.85rem', flex: '1 1 320px' }}>
                                    {response.dates?.length
                                        ? response.dates.map((date) => formatDate(date)).join(', ')
                                        : 'No dates selected'}
                                </div>

                                <div style={{ alignSelf: 'center' }}>
                                    <span
                                        style={{
                                            padding: '0.25rem 0.6rem',
                                            borderRadius: '999px',
                                            background: response.confirmed ? '#065f46' : '#334155',
                                            color: response.confirmed ? '#a7f3d0' : '#cbd5e1',
                                            fontSize: '0.75rem',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {response.confirmed ? 'Confirmed' : 'Draft'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
