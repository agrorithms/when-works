### Timezone Support (Follow-up)

Hosting follow-up form normalizes time input (6pm, 18:30, 6:30pm all valid) and stores as TIME type in DB. Timezone selector uses IANA identifiers with offset labels computed via Intl.DateTimeFormat.