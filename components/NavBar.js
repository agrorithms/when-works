'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'

export default function NavBar() {
    const { data: session, status } = useSession()
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const dropdownRef = useRef(null)

    useEffect(() => {
        const handleMouseDown = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleMouseDown)
        return () => document.removeEventListener('mousedown', handleMouseDown)
    }, [])

    useEffect(() => {
        const handleKey = (e) => {
            if (e.key === 'Escape') setDropdownOpen(false)
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [])

    const closeDropdown = () => setDropdownOpen(false)

    return (
        <nav className="navbar">
            <div className="navbar-inner">
                <Link href="/" className="navbar-brand">
                    When Works
                </Link>

                <div className="navbar-links">
                    <Link href="/events/new" className="nav-link">
                        Create event
                    </Link>
                    <Link href="/events" className="nav-link">
                        Dashboard
                    </Link>
                </div>

                <div className="navbar-auth" ref={dropdownRef}>
                    {status === 'loading' && (
                        <div className="navbar-skeleton" />
                    )}

                    {status === 'unauthenticated' && (
                        <button
                            className="button-primary navbar-signin"
                            onClick={() => signIn('google', { callbackUrl: '/events' })}
                        >
                            Sign in
                        </button>
                    )}

                    {status === 'authenticated' && (
                        <>
                            <button
                                className="navbar-user-btn"
                                onClick={() => setDropdownOpen((prev) => !prev)}
                                aria-expanded={dropdownOpen}
                                aria-haspopup="true"
                            >
                                <span className="navbar-user-name">
                                    {session.user?.name || session.user?.email}
                                </span>
                                <span className="navbar-chevron" aria-hidden="true">▾</span>
                            </button>

                            {dropdownOpen && (
                                <div className="navbar-dropdown" role="menu">
                                    <div className="navbar-dropdown-header">
                                        {session.user?.name && (
                                            <span>{session.user.name}</span>
                                        )}
                                        <span className="navbar-dropdown-email">{session.user?.email}</span>
                                    </div>
                                    {/*
                                    <Link href="/profile" className="navbar-dropdown-item" role="menuitem" onClick={closeDropdown}>
                                        Profile
                                    </Link>
                                    */}
                                    <Link href="/groups" className="navbar-dropdown-item" role="menuitem" onClick={closeDropdown}>
                                        My Groups
                                    </Link>
                                    <Link href="/settings" className="navbar-dropdown-item" role="menuitem" onClick={closeDropdown}>
                                        Settings
                                    </Link>
                                    <Link href="/help" className="navbar-dropdown-item" role="menuitem" onClick={closeDropdown}>
                                        Help
                                    </Link>
                                    <div className="navbar-dropdown-divider" />
                                    <button
                                        className="navbar-dropdown-item navbar-dropdown-signout"
                                        role="menuitem"
                                        onClick={() => {
                                            closeDropdown()
                                            signOut({ callbackUrl: '/' })
                                        }}
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </nav>
    )
}
