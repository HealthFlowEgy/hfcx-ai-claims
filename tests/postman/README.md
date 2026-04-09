# Postman collection — hfcx-ai-claims

## Files

- `hfcx-ai-claims.postman_collection.json` — all `/internal/ai/*`
  endpoints grouped by tag (SRS §6.2).

## Run in Postman

1. Import the collection via **File → Import**.
2. Set the collection variables:
   - `base_url` → the AI layer root (default `http://localhost:8090`)
   - `token`   → service-account JWT; `dev-token` works when
     `APP_ENV=development`
3. Run the whole collection or individual folders.

## Run in CI via `newman`

```bash
npm install -g newman
newman run tests/postman/hfcx-ai-claims.postman_collection.json \
  --env-var base_url=http://localhost:8090 \
  --env-var token=dev-token
```

The collection includes a post-response assertion on the coordinator
endpoint to verify the `adjudication_decision` enum and
`correlation_id` fields, giving `newman` a non-zero exit code when
the schema drifts.

## SRS mapping

| Folder         | SRS requirement(s)                                   |
|----------------|------------------------------------------------------|
| Health         | SRS §6.2, NFR-004                                    |
| Coordinator    | FR-AO-001, FR-AO-002                                 |
| Agents         | FR-EV-*, FR-MC-*, FR-FD-*, FR-MN-*                   |
| Memory         | FR-SM-001, FR-SM-002                                 |
| LLM            | SRS §6.2 (LiteLLM passthrough)                       |
| Drift Feedback | SRS §10.3                                            |
