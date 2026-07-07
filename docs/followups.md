### Timezone Support (Follow-up)

Hosting follow-up form normalizes time input (6pm, 18:30, 6:30pm all valid) and stores as TIME type in DB. Timezone selector uses IANA identifiers with offset labels computed via Intl.DateTimeFormat.

### Soft-deleted responses

`create_hosting_round` only invites ACTIVE responses (soft-deleted ones are excluded). Restoring a deleted response does NOT retro-add hosting invites to rounds created while it was deleted — the owner creates a new round or shares the public link if that matters. Invites minted before a delete keep working (they snapshot `invited_display_name`).
