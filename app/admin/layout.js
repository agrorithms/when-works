'use client'

import { useState, createContext, useContext } from 'react'
import Link from 'next/link'

const AdminContext = createContext(null)

export function useAdmin() {
    return useContext(AdminContext)
}

export default function AdminLayout({ children }) {
    const [authenticated, setAuthenticated] = useState(() => {
        if (typeof window === 'undefined') return false
        return sessionStorage.getItem('admin_auth') === 'true'
    })
    const [password, setPassword] = useState('')
    const [authError, setAuthError] = useState('')

    const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'changeme'

    const handleLogin = () => {
        if (password === ADMIN_PASSWORD) {
            setAuthenticated(true)
            sessionStorage.setItem('admin_auth', 'true')
            setAuthError('')
        } else {
            setAuthError('Wrong password.')
        }
    }

    if (!authenticated) {
        return (
            <div className="container" style={{ paddingTop: '4rem' }}>
                <h1>👑 Admin Dashboard</h1>
                <h2>Enter the admin password</h2>
                <input
                    type="password"
                    className="input-field"
                    placeholder="Password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                {authError && <p style={{ color: '#ef4444', margin: '0.5rem 0' }}>{authError}</p>}
                <button className="submit-btn" onClick={handleLogin}>Enter</button>
            </div>
        )
    }

    return (
        <AdminContext.Provider value={{ authenticated }}>
            {children}
        </AdminContext.Provider>
    )
}
