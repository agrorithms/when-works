const SAVED_GROUP_TOKENS_KEY = 'when_works_group_tokens'

export function readGroupTokens() {
    if (typeof window === 'undefined') return []
    try {
        return JSON.parse(localStorage.getItem(SAVED_GROUP_TOKENS_KEY) || '[]')
    } catch {
        return []
    }
}

export function saveGroupToken(token) {
    if (typeof window === 'undefined' || !token) return
    const tokens = readGroupTokens()
    if (!tokens.includes(token)) {
        localStorage.setItem(SAVED_GROUP_TOKENS_KEY, JSON.stringify([...tokens, token]))
    }
}
