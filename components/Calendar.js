'use client'

import { memo } from 'react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TAP_MOVE_THRESHOLD_PX = 10

function MonthGrid({
    year,
    month,
    selectedDates,
    onToggleDate,
    mode,
    startDate,
    endDate,
    blockedDates,
    showAvailabilityCounts,
    availabilityCounts,
    availabilityTotal
}) {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const monthName = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })

    const formatDate = (day) => {
        const m = String(month + 1).padStart(2, '0')
        const d = String(day).padStart(2, '0')
        return `${year}-${m}-${d}`
    }

    const isSelectable = (dateStr) => {
        if (startDate && dateStr < startDate) return false
        if (endDate && dateStr > endDate) return false
        if (blockedDates.includes(dateStr)) return false
        return true
    }

    const cells = []

    for (let i = 0; i < firstDay; i++) {
        cells.push(<div key={`empty-${i}`} className="day-cell empty" />)
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = formatDate(day)
        const selectable = isSelectable(dateStr)
        const isSelected = selectedDates.includes(dateStr)
        const availableCount = availabilityCounts[dateStr] || 0
        const availabilityTitle = `${availableCount} of ${availabilityTotal} other confirmed attendees are available on this day.`

        let className = 'day-cell'
        let style = { touchAction: 'manipulation' }

        if (showAvailabilityCounts) {
            style = { ...style, flexDirection: 'column' }
        }

        if (!selectable) {
            style = { ...style, opacity: 0.15, cursor: 'default' }
        } else if (isSelected) {
            className += mode === 'available' ? ' available' : ' unavailable'
        }

        cells.push(
            <div
                key={dateStr}
                className={className}
                style={style}
                title={showAvailabilityCounts && selectable ? availabilityTitle : undefined}
                onPointerDown={(e) => {
                    if (!selectable) return
                    e.currentTarget.dataset.pointerStartX = String(e.clientX)
                    e.currentTarget.dataset.pointerStartY = String(e.clientY)
                }}
                onPointerUp={(e) => {
                    if (!selectable) return

                    const startX = Number(e.currentTarget.dataset.pointerStartX)
                    const startY = Number(e.currentTarget.dataset.pointerStartY)
                    delete e.currentTarget.dataset.pointerStartX
                    delete e.currentTarget.dataset.pointerStartY

                    if (!Number.isFinite(startX) || !Number.isFinite(startY)) return

                    const movedX = Math.abs(e.clientX - startX)
                    const movedY = Math.abs(e.clientY - startY)
                    if (movedX > TAP_MOVE_THRESHOLD_PX || movedY > TAP_MOVE_THRESHOLD_PX) return

                    onToggleDate(dateStr)
                }}
                onPointerCancel={(e) => {
                    delete e.currentTarget.dataset.pointerStartX
                    delete e.currentTarget.dataset.pointerStartY
                }}
            >
                {showAvailabilityCounts ? (
                    <>
                        <span style={{ lineHeight: 1.1 }}>{day}</span>
                        {selectable && (
                            <span style={{
                                fontSize: '0.72rem',
                                opacity: 0.85,
                                marginTop: '0.15rem',
                                lineHeight: 1
                            }}>
                                {availableCount}/{availabilityTotal}
                            </span>
                        )}
                    </>
                ) : (
                    day
                )}
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

            <div className="calendar-grid" style={{ touchAction: 'manipulation' }}>
                {DAYS.map(d => (
                    <div key={d} className="day-label">{d}</div>
                ))}
                {cells}
            </div>
        </div>
    )
}

function Calendar({
    selectedDates,
    onToggleDate,
    mode,
    startDate,
    endDate,
    blockedDates = [],
    showAvailabilityCounts = false,
    availabilityCounts = {},
    availabilityTotal = 0
}) {
    const getMonthsInRange = () => {
        if (!startDate || !endDate) {
            const now = new Date()
            return [{ year: now.getFullYear(), month: now.getMonth() }]
        }

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

    return (
        <div>
            {months.map(({ year, month }) => (
                <MonthGrid
                    key={`${year}-${month}`}
                    year={year}
                    month={month}
                    selectedDates={selectedDates}
                    onToggleDate={onToggleDate}
                    mode={mode}
                    startDate={startDate}
                    endDate={endDate}
                    blockedDates={blockedDates}
                    showAvailabilityCounts={showAvailabilityCounts}
                    availabilityCounts={availabilityCounts}
                    availabilityTotal={availabilityTotal}
                />
            ))}
        </div>
    )
}

export default memo(Calendar)
