### Session & Confirmation Flow

1. User can make date selections before providing name (pending toggles in ref)
2. First selection triggers session creation (POST response record)
3. Session name auto-loads from localStorage (persistent across page reloads)
4. Name changes debounced and auto-saved
5. "Confirm" locks in state (confirmed: true), prevents further edits unless explicitly reset

### Key Client-Side Patterns

**State Management**:
- React hooks with refs for debounced saves (availableDatesRef, unavailableDatesRef, responseIdRef)
- Separate UI state (availableDates/unavailableDates) from saved data in refs to prevent race conditions
- useCallback dependencies carefully scoped to avoid infinite loops during auto-saves

**Data Persistence**:
- localStorage for user name (NAME_STORAGE_KEY), saved invite slugs (SAVED_INVITES_KEY), session keys (getSessionKey(slug))
- Debounced Supabase updates: 2000ms for date changes, 1000ms for names, 600ms for includes_so toggle
- Pending toggles buffered in refs until session starts (for race-condition safety before response record created)

**Save Strategy**:
- Unsaved selections trigger soft updates (confirmed: false)
- Only confirmed: true submissions lock in final state
- Reset functionality via snapshot mechanism (captures entire state, allows undo)