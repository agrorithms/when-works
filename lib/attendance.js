// Attendance math shared by server routes and client pages. Keep this file
// dependency-free so it stays importable from client components.

export function getAttendeeWeight(response) {
    return response.includes_so ? 2 : 1
}

export function isResponseAvailableOnDate(response, dateStr) {
    const dates = response.dates || []
    if (response.response_type === 'available') return dates.includes(dateStr)
    return !dates.includes(dateStr)
}

export function isActiveResponse(response) {
    return !response.deleted_at
}
