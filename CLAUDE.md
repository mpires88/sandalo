@AGENTS.md

## Supabase query limits

PostgREST returns a maximum of 1000 rows by default. Never fetch all rows and filter client-side — always filter server-side so the query only returns the rows you need:

- Use `.eq()`, `.in()`, `.filter()`, etc. to narrow results on the server
- For JSONB array containment use `.filter('col', 'cs', JSON.stringify(value))` — do NOT use `.contains()` (it serializes arrays as `{[object Object]}`)
- If a broad fetch is truly unavoidable, add `.limit(10000)` and leave a comment explaining why

Symptoms of hitting the limit: data appears to stop at a random date mid-stream, counts look low but no error is thrown.
