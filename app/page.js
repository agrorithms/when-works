'use client'

import Link from 'next/link'
import { signIn, signOut, useSession } from 'next-auth/react'

function HeroCard({ title, description, href, primary = false, onClick }) {
    const cardStyles = {
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        border: '1px solid rgba(148, 163, 184, 0.18)',
        background: primary
            ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(15, 23, 42, 0.95))'
            : 'rgba(15, 23, 42, 0.82)',
        borderRadius: '18px',
        padding: '1.1rem',
        boxShadow: '0 20px 50px rgba(15, 23, 42, 0.22)',
        cursor: href || onClick ? 'pointer' : 'default',
        minHeight: '132px',
    }

    if (href) {
        return (
            <Link href={href} style={cardStyles}>
                <p style={{ color: primary ? '#c7d2fe' : '#94a3b8', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    {primary ? 'Recommended' : 'Quick action'}
                </p>
                <h3 style={{ fontSize: '1.15rem', marginBottom: '0.45rem', color: '#f8fafc' }}>{title}</h3>
                <p style={{ color: primary ? '#e0e7ff' : '#cbd5e1', lineHeight: 1.5 }}>{description}</p>
            </Link>
        )
    }

    if (onClick) {
        return (
            <button type="button" onClick={onClick} style={cardStyles}>
                <p style={{ color: primary ? '#c7d2fe' : '#94a3b8', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    {primary ? 'Recommended' : 'Quick action'}
                </p>
                <h3 style={{ fontSize: '1.15rem', marginBottom: '0.45rem', color: '#f8fafc' }}>{title}</h3>
                <p style={{ color: primary ? '#e0e7ff' : '#cbd5e1', lineHeight: 1.5 }}>{description}</p>
            </button>
        )
    }

    return (
        <div style={cardStyles}>
            <p style={{ color: primary ? '#c7d2fe' : '#94a3b8', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                {primary ? 'Recommended' : 'Quick action'}
            </p>
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.45rem', color: '#f8fafc' }}>{title}</h3>
            <p style={{ color: primary ? '#e0e7ff' : '#cbd5e1', lineHeight: 1.5 }}>{description}</p>
        </div>
    )
}

export default function HomePage() {
    const { data: session, status } = useSession()
    const signedIn = status === 'authenticated'

    return (
        <div
            style={{
                minHeight: '100vh',
                background:
                    'radial-gradient(circle at top left, rgba(99, 102, 241, 0.24), transparent 28%), radial-gradient(circle at top right, rgba(16, 185, 129, 0.18), transparent 22%), #0f172a',
            }}
        >
            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <p style={{ color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            When Works
                        </p>
                        <h1 style={{ fontSize: '3rem', lineHeight: 1, marginTop: '0.35rem' }}>
                            Find the best day for everyone to hang out.
                        </h1>
                        <p style={{ color: '#cbd5e1', maxWidth: '42rem', marginTop: '1rem', fontSize: '1.05rem' }}>
                            Create events, share a simple link, and let people respond without forcing them to sign in.
                            Creators can use Google, an email claim flow, or a private owner link.
                        </p>
                    </div>

                    <div
                        style={{
                            minWidth: '220px',
                            background: 'rgba(15, 23, 42, 0.9)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            borderRadius: '18px',
                            padding: '1rem',
                            alignSelf: 'flex-start',
                        }}
                    >
                        {signedIn ? (
                            <>
                                <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Signed in as</p>
                                <p style={{ color: '#f8fafc', marginTop: '0.25rem', wordBreak: 'break-word' }}>
                                    {session?.user?.email}
                                </p>
                                <button onClick={() => signOut({ callbackUrl: '/' })} className="button-secondary" style={{ marginTop: '0.85rem', width: '100%' }}>
                                    Sign out
                                </button>
                            </>
                        ) : (
                            <>
                                <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Start here</p>
                                <button onClick={() => signIn('google', { callbackUrl: '/events' })} className="button-primary" style={{ marginTop: '0.65rem', width: '100%' }}>
                                    Continue with Google
                                </button>
                                <Link href="/events" className="nav-link" style={{ display: 'block', marginTop: '0.85rem' }}>
                                    View my events
                                </Link>
                            </>
                        )}
                    </div>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '1rem',
                        marginTop: '2rem',
                    }}
                >
                    <HeroCard
                        title="Create an event"
                        description="Choose Google, email claim, or a private owner link."
                        href="/events/new"
                        primary
                    />
                    <HeroCard
                        title="Open my dashboard"
                        description="See events you created plus any saved invite links on this browser."
                        href="/events"
                    />
                    <HeroCard
                        title="Respond to an invite"
                        description="Open the event link you received and submit availability without signing in."
                    />
                    <HeroCard
                        title="Super-admin view"
                        description="Keep using the internal admin area for your advanced management tools."
                        href="/admin"
                    />
                </div>

                <div className="section-card" style={{ marginTop: '2rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.35rem' }}>How it works</h2>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                            gap: '0.9rem',
                        }}
                    >
                        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '14px', padding: '1rem' }}>
                            <h3 style={{ marginBottom: '0.35rem' }}>1. Share a public link</h3>
                            <p style={{ color: '#cbd5e1' }}>
                                The event link can be copied and sent to anyone without pre-registering invitees by email.
                            </p>
                        </div>
                        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '14px', padding: '1rem' }}>
                            <h3 style={{ marginBottom: '0.35rem' }}>2. Pick creator access</h3>
                            <p style={{ color: '#cbd5e1' }}>
                                Creators can sign in with Google, claim by email later, or save a private owner link.
                            </p>
                        </div>
                        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '14px', padding: '1rem' }}>
                            <h3 style={{ marginBottom: '0.35rem' }}>3. Check your dashboard</h3>
                            <p style={{ color: '#cbd5e1' }}>
                                `/events` keeps track of created events and any invite links you have saved in this browser.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
