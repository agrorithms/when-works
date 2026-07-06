### Session & Confirmation Flow

1. User can make date selections before providing name (pending toggles in ref)
2. First selection triggers session creation (`POST /api/respond/[slug]` action `'start'`), which returns the response row plus both tokens: the legacy `response_token` (kept in memory for this page load) and the device-wide `participant_token` (stored in the global localStorage key)
3. Sessions auto-resume on page load: signed-in users from the server-side participant/email match; guests via a `resolveOnly: true` start probe against the stored participant token (or a legacy per-slug response token) — the probe never creates a row, so merely viewing an event mints nothing. Resolution never uses a typed name (token-only identity: duplicate names create separate responses)
4. Name changes debounced and auto-saved
5. "Confirm" locks in state (confirmed: true), prevents further edits unless explicitly reset

### Key Client-Side Patterns

**State Management**:
- React hooks with refs for debounced saves (availableDatesRef, unavailableDatesRef, responseIdRef, responseTokenRef, participantTokenRef)
- Separate UI state (availableDates/unavailableDates) from saved data in refs to prevent race conditions
- useCallback dependencies carefully scoped to avoid infinite loops during auto-saves

**Data Persistence**:
- localStorage: user name (NAME_STORAGE_KEY), saved invite slugs (SAVED_INVITES_KEY), and the device-wide participant token (`when_works_participant_token` — one identity across all events)
- Legacy per-event keys (`when_works_response_token_<slug>`) are still READ (old browsers resume and get adopted into a device participant server-side) but never written anymore
- Every `POST /api/respond/[slug]` sends both `participantToken` and `responseToken` (via `authTokens()`); the server validates dates against the event range and strips blocked dates
- Debounce timings: 2000ms for date changes, 1000ms for names, 600ms for includes_so toggle
- Pending toggles buffered in refs until session starts (for race-condition safety before response record created)

**Save Strategy**:
- Unsaved selections trigger soft updates (confirmed: false)
- Only confirmed: true submissions lock in final state
- Reset functionality via snapshot mechanism (captures entire state, allows undo)

**Owner-side soft delete**:
- Deleting a response (owner page) sets `deleted_at`; the guest's next visit starts a completely fresh response — restore is the owner's tool, not the guest's
- Restoring pre-checks for a newer active response from the same participant (409 with a "delete that one first" message; also enforced by the partial unique index)
