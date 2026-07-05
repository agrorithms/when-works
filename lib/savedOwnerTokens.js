const SAVED_OWNER_TOKENS_KEY = 'when_works_saved_owner_tokens'

export function readOwnerTokens() {
    if (typeof window === 'undefined') return []
    try {
        return JSON.parse(localStorage.getItem(SAVED_OWNER_TOKENS_KEY) || '[]')
    } catch {
        return []
    }
}

export function saveOwnerToken(token) {
    if (typeof window === 'undefined' || !token) return
    const tokens = readOwnerTokens()
    if (!tokens.includes(token)) {
        localStorage.setItem(SAVED_OWNER_TOKENS_KEY, JSON.stringify([...tokens, token]))
    }
}
