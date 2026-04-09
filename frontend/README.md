# HealthFlow HCX — Frontend Portals

Next.js 14 implementation of the four role-based portals defined in
`docs/SRS-HealthFlow-HCX-Frontend-Portals-v1.0.docx`:

1. **Provider Portal** (`/provider`) — claims submission, eligibility
   check, denials + appeals.
2. **Payer Dashboard** (`/payer`) — Kanban claims queue with AI
   recommendations and decision panel.
3. **SIU Portal** (`/siu`) — fraud investigations, network graph,
   cross-payer search.
4. **Regulatory Dashboard** (`/regulatory`) — FRA-facing market
   overview and compliance reports.

## Tech stack

| Layer | Tool |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives) |
| i18n | next-intl (Arabic RTL default + English LTR) |
| Data | TanStack Query + React Hook Form + Zod |
| Tables | TanStack Table |
| Charts | Recharts |
| Graphs | React Flow |
| Geo | react-simple-maps (Egypt governorate map) |
| Icons | Lucide React |
| Tests | Vitest + @testing-library/react + Playwright |

## Design system

- **Arabic RTL is the default.** The `<html>` element is rendered
  `dir="rtl" lang="ar"` from `getLocale()` on every request; the
  `LanguageToggle` component writes a cookie to switch to English.
- **CSS logical properties only** — no `margin-left`, `padding-right`,
  `left`, etc. Linted by Tailwind class suggestions.
- **Color tokens** in `app/globals.css` mirror SRS §2.2 exactly, served
  as HSL triples so shadcn/ui's dark-mode tooling works if enabled later.
- **Status badges** (`components/shared/claim-status-badge.tsx`) always
  carry color + icon + label, satisfying WCAG 2.1 AA `DS-A11Y-002`.
- **Arabic-Indic numeral rendering** is centralized in
  `lib/utils.ts::toArabicDigits`.

## Directory layout

```
frontend/
├── app/
│   ├── layout.tsx                # Root layout — fonts, html lang+dir
│   ├── page.tsx                  # Portal selector (SRS §3.1)
│   ├── provider/                 # Provider Portal
│   │   ├── layout.tsx            # Shell + nav
│   │   ├── page.tsx              # Dashboard (§4.2.1)
│   │   ├── claims/
│   │   │   ├── page.tsx          # Claims history (§4.2.3)
│   │   │   └── new/page.tsx      # New claim form (§4.2.2)
│   ├── payer/                    # Payer Dashboard
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Dashboard (§5.1)
│   │   └── claims/page.tsx       # Kanban queue (§5.2.1)
│   ├── siu/                      # SIU Portal
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Dashboard (§6.1)
│   │   ├── flagged/page.tsx      # Flagged claims (§6.2.1)
│   │   └── network/page.tsx      # Network graph (§6.2.2)
│   ├── regulatory/               # Regulatory Dashboard
│   │   ├── layout.tsx
│   │   └── page.tsx              # Market overview (§7.2.1)
├── components/
│   ├── layout/portal-shell.tsx   # Sidebar + header chrome
│   ├── providers.tsx             # QueryClient provider
│   ├── shared/                   # SRS §8 shared components library
│   │   ├── ai-recommendation-card.tsx
│   │   ├── claim-card.tsx
│   │   ├── claim-status-badge.tsx
│   │   ├── confidence-bar.tsx
│   │   ├── data-table.tsx
│   │   ├── fraud-gauge.tsx
│   │   ├── kpi-card.tsx
│   │   ├── language-toggle.tsx
│   │   ├── network-graph.tsx
│   │   └── patient-nid-input.tsx
│   └── ui/                       # shadcn/ui primitives
├── lib/
│   ├── api.ts                    # Backend API client
│   ├── types.ts                  # Backend contracts (mirrors Pydantic)
│   └── utils.ts                  # cn(), formatters, digit conversion
├── messages/{ar,en}.json         # next-intl translations
├── tests/                        # Vitest unit tests
├── e2e/                          # Playwright E2E tests
├── i18n.ts                       # next-intl config
├── tailwind.config.ts
├── next.config.mjs
└── Dockerfile
```

## Running locally

```bash
cd frontend
npm install
# Backend must be running on :8090 — see main README.
export NEXT_PUBLIC_API_BASE_URL=http://localhost:8090
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The portal selector
will show all four cards; click one to enter the corresponding portal.

## Tests

```bash
# Vitest unit tests + coverage
npm run test
npm run test:coverage

# Playwright E2E (requires the app to be built first)
npm run build && npm run test:e2e
```

The unit-test suite covers:
- `lib/utils.ts` (Arabic-Indic digit conversion, currency formatting,
  date formatting, NID masking, clamp)
- `ClaimStatusBadge` — all eight statuses rendered in Arabic + English
  with icon, label, and `aria-label`
- `ConfidenceBar` — color bucket thresholds per SRS §DS-AI-001
- `FraudGauge` — all three risk zones, Arabic-Indic numerals, factor list
- `PatientNidInput` — digit-only input, Arabic-Indic normalization,
  14-digit validation
- `api` client — correlation ID header, error normalization, query
  string builder

The E2E Playwright suite runs in both `ar-EG` and `en-US` locales to
cover SRS §TST-AR-001 visual-regression requirements.

## API integration

All backend calls go through `lib/api.ts`, which:

- Reads the backend base URL from `NEXT_PUBLIC_API_BASE_URL`.
- Injects an `X-HCX-Correlation-ID` header on every request so logs
  and traces across the stack line up (NFR-006).
- Normalizes errors into a single `ApiError` class with `{ status, code,
  message, correlationId }` so the UI can handle 401 / 403 / 422 / 503
  responses uniformly (SRS §9.3).

The backend exposes BFF routes at `/internal/ai/bff/*` specifically for
the portals — see `src/api/routes/bff.py`. Every summary endpoint
returns a safe zero-filled fallback if the database is unreachable so
the dashboards still render during startup or partial outages.

## Deployment

```bash
# Build + run via docker compose (brings up backend + frontend)
docker compose up -d frontend

# Or deploy to the hcx-ai namespace
kubectl apply -f ../k8s/frontend.yaml
```

See `../k8s/frontend.yaml` for the production manifest.
