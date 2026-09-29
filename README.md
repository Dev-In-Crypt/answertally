# Answertally

The operating system for AI Search retainers. Agencies measure how ChatGPT, Perplexity and Grok
answer about their clients, find where the client is losing and why, turn that into work, measure
what moved, and hand the client a white-label report.

The product name never appears on anything the agency's own client sees — reports and PDFs carry
the agency's logo and colour only.

## What it does

The working object is an **opportunity**: where this client is losing, on which questions, why, and
what is worth doing about it. Everything else exists to produce one or to act on it.

- **Measure.** Repeated samples per prompt across three platforms, aggregated into weekly windows.
  Visibility is the share of answers mentioning the brand, never a single answer.
- **Find.** Four detectors over the measured answers — a competitor ahead on a question, a cited
  source the client is missing from, own pages that are read but do not carry the brand, a topic
  trailing the rest. Each opportunity is scored 0–100 and stores the breakdown, so "why is this 91
  and that 43" has an answer that does not require recomputing anything.
- **Explain.** Every opportunity opens onto the evidence it was built from: the window, the sample
  size, the affected questions, the competitors named there, and only then example answers.
- **Deliver.** Convert an opportunity into an action and it carries its reason, evidence and topics
  with it. Actions board, experiments with a comparison group, activity log.
- **Report.** A public link the client opens without an account, plus PDF export printed from that
  same page.
- **Audit.** A free-audit mode for prospects: generated buyer prompts, one measurement pass, ranked
  opportunities, a 90-day plan built from them, and conversion to a client that rebuilds nothing.

Estimates are labelled as estimates. Words claiming proven causation are banned from the UI and
reports, and a test enforces it.

The 0–100 score is an internal triage number and stays internal: in a white-label report it would
read as a grade of the client's website.

## Stack

pnpm workspaces + Turborepo.

| Package | What lives there |
|---|---|
| `apps/web` | Next.js 15 App Router, tRPC, Tailwind |
| `apps/worker` | BullMQ worker: runs, parsing, aggregation |
| `packages/core` | Pure business logic — adapters, parsing, metrics, experiment math, report schema |
| `packages/db` | Drizzle schema and migrations, the only place tables are defined |
| `packages/pipeline` | The measurement pipeline shared by web and worker |

## Getting started

```bash
cp .env.example .env && docker compose up -d && pnpm install && pnpm db:migrate && pnpm dev
```

Platform adapters run in mock mode by default (`ADAPTERS_MODE=mock`) — no network, no API keys, and
tests never call out.

Four assistants are measured: ChatGPT, Perplexity, Grok and Claude. A new client is measured on
the first three; Claude is switched on per client in the schedule, because it adds answers to every
run and needs its own key (`ANTHROPIC_API_KEY`). All four have been checked with live calls — run
`live-check` (see `packages/core/src/adapters/live-check.ts`) with a key to repeat that.

Copilot and Google's AI surfaces have no public answer API, so they stay listed as not measured.
Gemini is listed there too, and for a different reason: the adapter exists and works, but Google's
terms for grounded search do not allow the results to be analysed, or kept the way every answer
here is kept so a figure can be rechecked. It is not registered even when a key is set.

Perplexity is measured through its Agent API (`fast` preset), which replaced Sonar on 2026-09-27.
That preset answers with an OpenAI model over Perplexity's own search, so each answer records the
actual model in its version string rather than passing it off as Perplexity's.

## Commands

```bash
pnpm dev          # web + worker
pnpm test         # unit and integration tests
pnpm e2e          # Playwright, against a production build
pnpm lint && pnpm typecheck
pnpm db:migrate | db:seed | db:studio
```

`db:seed` also runs one fixture-backed measurement pass through the real pipeline, so a fresh
database comes up with snapshots, opportunities, actions and an experiment. None of those numbers
are written by hand — they are produced by the same code that runs in production, only the answers
come from fixtures.

## Deploying

One machine with Docker is enough for the first dozens of agencies:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Four services: Postgres, Redis, web, worker. Migrations run as a one-shot service before the app
starts — the application never changes the schema itself, or two instances would do it at once.
Web and worker are separate images because a measurement run takes minutes and must not share a
process with request handling.

`/api/health` answers 503 while the database is unreachable, so the platform can hold traffic back
instead of serving empty reports.

`.env.production` needs at minimum `POSTGRES_PASSWORD`, `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL`. Everything else is optional and the product states
plainly what it cannot do without it: `ADAPTERS_MODE` stays on fixtures until platform keys are
present, email is written to the log until `RESEND_API_KEY` is set, and payments are simply not
offered until Stripe is configured.

## Public API

Read-only, keyed per agency, created in Settings → API. The key is shown once; only its hash is
stored.

```bash
curl -H "Authorization: Bearer $ANSWERTALLY_KEY" https://your-host/api/v1/clients
```

| Endpoint | Returns |
|---|---|
| `GET /api/v1/clients` | Clients of the agency |
| `GET /api/v1/clients/{id}/visibility` | Prompt × assistant matrix, intervals, movement |
| `GET /api/v1/clients/{id}/sources` | Cited sources and presence |
| `GET /api/v1/clients/{id}/opportunities` | Ranked gaps with score, evidence level and reason |
| `GET /api/v1/clients/{id}/actions` | Work queue, each row with its reason |
| `GET /api/v1/reports` | Reports and their status |

Figures come from the same functions that render the screens, and carry the same intervals — a
number without one becomes "we grew three points" in someone else's dashboard, which the sample
never claimed.

## Conventions worth knowing

- Every data query goes through `protectedProcedure` + `assertTenant`. A resource belonging to
  another agency returns NOT_FOUND, never FORBIDDEN — the API must not confirm that it exists.
- Visibility is only ever computed from aggregates: at least three samples per prompt per platform,
  weekly windows. Raw responses are always kept, so a parser change can be replayed.
- Opportunities are recomputed after every run, and that recompute never writes a human decision.
  Status, dismissal reason and first-detected date belong to the person; a dismissal records the
  score it was made at and only comes back if the gap grows well past it.
- Scoring is deterministic and versioned. Confidence multiplies rather than adds, so a gap nobody
  has measured properly cannot reach the top of the queue on size alone.
- Wording that claims proven causation is banned in the UI and in reports; approved phrasings live
  in `packages/core/src/copy.ts` and a test greps for violations.
- Reports and PDFs carry the agency's brand only. A test asserts the product leaves no trace there.
- Nothing is ever published to an external system on the client's behalf.

Planning documents and the product spec are kept outside this repository.
