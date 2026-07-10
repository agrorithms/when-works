// Auth for the daily cron route. Vercel Cron invokes the route with
// `Authorization: Bearer $CRON_SECRET` when that env var is set on the
// project; the x-admin-password fallback allows manual triggering in
// dev/staging (and only that path may override "today" for testing).

import crypto from 'crypto'
import { isAdminRequest } from './adminAuth'

function safeEqual(a, b) {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
}

export function isCronRequest(request) {
    const expected = process.env.CRON_SECRET
    if (!expected) return false
    const header = request.headers.get('authorization') || ''
    if (!header.startsWith('Bearer ')) return false
    return safeEqual(header.slice('Bearer '.length), expected)
}

// { authorized, isAdmin } — isAdmin gates the ?date= test override.
export function resolveCronAuth(request) {
    if (isCronRequest(request)) return { authorized: true, isAdmin: false }
    if (isAdminRequest(request)) return { authorized: true, isAdmin: true }
    return { authorized: false, isAdmin: false }
}
