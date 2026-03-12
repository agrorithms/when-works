'use client'

import Link from 'next/link'

export default function AdminHomePage() {
    return (
        <div className="container" style={{ paddingTop: '2rem' }}>
            <h1>👑 Admin Dashboard</h1>
            <h2>What would you like to do?</h2>

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                maxWidth: '500px',
                marginTop: '2rem'
            }}>
                <Link href="/admin/create" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1.5rem',
                    background: '#6366f1',
                    color: 'white',
                    borderRadius: '12px',
                    textDecoration: 'none',
                    fontSize: '1.1rem',
                    fontWeight: '600',
                    transition: 'background 0.15s ease'
                }}>
                    <span style={{ fontSize: '1.5rem' }}>➕</span>
                    <div>
                        <div>Create New Event</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 400, opacity: 0.8, marginTop: '0.25rem' }}>
                            Set up a new hangout with date range and blocked dates
                        </div>
                    </div>
                </Link>

                <Link href="/admin/events" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1.5rem',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    borderRadius: '12px',
                    textDecoration: 'none',
                    fontSize: '1.1rem',
                    fontWeight: '600',
                    border: '2px solid #334155',
                    transition: 'border-color 0.15s ease'
                }}>
                    <span style={{ fontSize: '1.5rem' }}>📋</span>
                    <div>
                        <div>View Events</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 400, color: '#94a3b8', marginTop: '0.25rem' }}>
                            See responses, availability, and find the best dates
                        </div>
                    </div>
                </Link>
            </div>
        </div>
    )
}
