import crypto from 'crypto'

const ADMIN_PASSWORD_HEADER = 'x-admin-password'

function safeEqual(a, b) {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
}

export function isValidAdminPassword(password) {
    const expected = process.env.ADMIN_PASSWORD
    if (!expected || typeof password !== 'string' || password.length === 0) return false
    return safeEqual(password, expected)
}

export function isAdminRequest(request) {
    return isValidAdminPassword(request.headers.get(ADMIN_PASSWORD_HEADER))
}
