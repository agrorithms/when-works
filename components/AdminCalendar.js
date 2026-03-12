'use client'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function AdminMonthGrid({ year, month, startDate, endDate, blockedDates, onToggleBlocked }) {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const monthName = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })

    const formatDate = (day) => {
        const m = String(month + 1).padStart(2, '0')
        const d = String(day).padStart(2, '0')
        return `${year}-${m}-${d}`
    }

    const isInRange = (dateStr) => {
        if (!startDate || !endDate) return false
        return dateStr >= startDate && dateStr <= endDate
    }

    const cells = []

    for (let i = 0; i < firstDay; i++) {
        cells.push(<div key={`empty-${i}`} className="day-cell empty" />)
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = formatDate(day)
        const inRange = isInRange(dateStr)
        const isBlocked = blockedDates.includes(dateStr)

        let className = 'day-cell'
        let style = {}

        if (!inRange) {
            style = { opacity: 0.15, cursor: 'default' }
        } else if (isBlocked) {
            className += ' unavailable'
        } else {
            className += ' available'
        }

        cells.push(
            <div
                key={dateStr}
                className={className}
                style={style}
                onClick={() => inRange && onToggleBlocked(dateStr)}
            >
                {day}
            </div>
        )
    }

    return (
        <div style={{ marginBottom: '2rem' }}>
            <h2 style={{
                color: '#f8fafc',
                fontWeight: 600,
                textAlign: 'center',
                marginBottom: '0.75rem',
                fontSize: '1.2rem'
            }}>
                {monthName}
            </h2>

            <div className="calendar-grid">
                {DAYS.map(d => (
                    <div key={d} className="day-label">{d}</div>
                ))}
                {cells}
            </div>
        </div>
    )
}

export default function AdminCalendar({ startDate, endDate, blockedDates, onToggleBlocked }) {
    const getMonthsInRange = () => {
        if (!startDate || !endDate) return []

        const start = new Date(startDate + 'T12:00:00')
        const end = new Date(endDate + 'T12:00:00')
        const months = []

        let current = new Date(start.getFullYear(), start.getMonth(), 1)
        const last = new Date(end.getFullYear(), end.getMonth(), 1)

        while (current <= last) {
            months.push({ year: current.getFullYear(), month: current.getMonth() })
            current = new Date(current.getFullYear(), current.getMonth() + 1, 1)
        }

        return months
    }

    const months = getMonthsInRange()

    if (months.length === 0) return null

    return (
        <div>
            {months.map(({ year, month }) => (
                <AdminMonthGrid
                    key={`${year}-${month}`}
                    year={year}
                    month={month}
                    startDate={startDate}
                    endDate={endDate}
                    blockedDates={blockedDates}
                    onToggleBlocked={onToggleBlocked}
                />
            ))}
        </div>
    )
}
