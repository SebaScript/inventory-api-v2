# Inventory API

RESTful inventory API with NestJS + TypeScript + PostgreSQL, containerised with Docker and guarded by two CI/CD pipelines with coverage gates.

The Test and Production environments are deployed on **Render**, each from the
image its pipeline published. Everything below runs locally with Docker alone:

```bash
git clone https://github.com/SebaScript/inventory-api-v2.git
cd inventory-api-v2

npm run docker:dev    # http://localhost:3000  ·  /docs  ·  /health
```

| | Local | Test | Production |
|---|---|---|---|
| Runs on | Docker on your machine | Render | Render |
| API | `http://localhost:3000` | its own Render URL | its own Render URL |
| Database | container, `inventory_dev` | its own managed PostgreSQL | its own managed PostgreSQL |
| Configuration | `.env` | env vars on the Render service | env vars on the Render service |
| Demo data | yes | yes | never |
| Updated by | you | Test Pipeline (`develop`) | Production Pipeline (`main`) |

## API

### Groups: `/groups`

A group is a category. It is the dimension items are classified by.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/groups` | Creates a category. The name is unique, case insensitive |
| `GET` | `/groups` | Lists categories, paginated. `?search` matches the name |
| `GET` | `/groups/:id` | Returns one category |
| `PATCH` | `/groups/:id` | Updates only the fields that were sent; the rest stay as they are |
| `DELETE` | `/groups/:id` | Deletes it, but only if it is empty — otherwise `409` |

### Items: `/items`

An item is a product. It holds the **current state**: how much stock there is right now.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/items` | Creates a product inside a category. An optional opening stock is written as an `IN` movement, so even the first units have a ledger entry |
| `GET` | `/items` | Lists products with their category. Filters: `?search` (name or SKU), `?groupId`, `?lowStock`, `?status` |
| **`QUERY`** | **`/items/search`** | Advanced search whose filter travels in the **body**: free text, a *list* of categories and a price range |
| `POST` | `/items/search` | The same search, for clients and tools that cannot send the QUERY verb |
| `GET` | `/items/:id` | Returns one product, discontinued ones included |
| `PATCH` | `/items/:id` | Updates only the fields that were sent. The stock is never one of them. Also brings a product back with `{"status":"ACTIVE"}` |
| `DELETE` | `/items/:id` | **Discontinues** it: it leaves the listings and accepts no more movements, but neither it nor its history is erased |

### Movements: `/movements`

A movement is an entry or exit of stock. It is the **immutable event log** that explains every unit — hence no `PUT`, `PATCH` or `DELETE`. A mistake is corrected with an opposite movement.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/movements` | Records an `IN` or `OUT` **and** updates the item's stock in a single transaction, with the row locked. `409` if there is not enough stock, and then nothing is written |
| `GET` | `/movements` | Lists the ledger, newest first. Filters: `?itemId`, `?type` |
| `GET` | `/movements/:id` | Returns one entry together with its product |

### Health: `/health`

| Method | Path | What it does |
|---|---|---|
| `GET` | `/health` | Runs a real query against PostgreSQL. `503` if the database is unreachable. Docker uses it as the container `HEALTHCHECK` |

### Errors

Every failure has the same shape. Branch on `code`, not on `message`.

```jsonc
{
  "statusCode": 409,
  "code": "INSUFFICIENT_STOCK",
  "message": "Item 1 has 75 unit(s) available, 99999 requested",
  "available": 75,
  "requested": 99999,
  "path": "/movements",
  "timestamp": "2026-08-18T15:29:44.337Z"
}
```

| Status | When |
|---|---|
| `400` | Validation failed (body, params, query) |
| `404` | The resource does not exist |
| `409` | Duplicate name/SKU, non-empty group, discontinued item, **insufficient stock** |
| `422` | A database rule was broken |
| `500` | Unexpected — generic message only, details go to the log |
| `503` | Health check: PostgreSQL unreachable |

In production an unexpected error returns only `"Internal server error"`. A test asserts that a thrown error containing a password never appears in the response.

## Database

```
      Group                          Item                        Movement
  ┌───────────┐                 ┌────────────┐               ┌────────────────┐
  │ id        │                 │ id         │               │ id             │
  │ name  (U) │ 0..N       1..1 │ group_id   │          0..N │ item_id        │
  │ descrip.  │◄──── clasifica ─┤ sku    (U) │◄─── registra ─┤ type  (IN|OUT) │
  │ created   │                 │ quantity   │          1..1 │ quantity  > 0  │
  │ updated   │                 │ min_stock  │               │ resulting_stock│
  └───────────┘                 │ unit_price │               │ reason         │
                                │ status     │               │ created_at     │
                                └────────────┘               └────────────────┘
                ON DELETE RESTRICT            ON DELETE RESTRICT
```

| Rule | Why |
|---|---|
| `UNIQUE` name on groups | One category per name; the API also compares case-insensitively |
| `UNIQUE` sku (stored uppercase) | Makes SKU uniqueness real, not cosmetic |
| `CHECK (quantity >= 0)` | The invariant's last line of defence |
| `CHECK (quantity > 0)` on movements | Direction comes from `type`, never from a sign |
| `ON DELETE RESTRICT` groups → items | Deleting a category must not destroy inventory |
| `ON DELETE RESTRICT` items → movements | A movement can never be orphaned; history is permanent |

---

## Environments

Test and Production are two **Render web services**, each running the image its
own pipeline published, and each bound to its own managed PostgreSQL. They share
nothing:

| | Test | Production |
|---|---|---|
| URL | its own `*.onrender.com` host | its own `*.onrender.com` host |
| Database | its own instance | its own instance |
| Configuration | env vars on that service | env vars on that service |
| Image tag | `:test` | `:prod` |
| Deployed from | `develop` | `main` |
| Demo data | `SEED=true` | `SEED=false` |

Production starts with an empty inventory, and the guard is not only that flag:
the application refuses to seed whenever `NODE_ENV=production`, even if `SEED`
were set to true.

Neither service builds anything. Render pulls the image the pipeline published,
pinned to the exact commit, so what runs in an environment is byte for byte what
cleared the quality gates.

### Running an environment locally

`docker-compose.yml` is parameterised by an env file, so the same stack can be
raised on your own machine — useful for development, and as a fallback if the
hosted environment is unavailable:

```bash
cp .env.test.example .env.test              # set a real password
npm run docker:test                          # http://localhost:3100
```

---

## Testing and coverage

28 tests against **real PostgreSQL** — the suite asserts on transactions, row locks and CHECK constraints, none of which can be faked.

```bash
npm run db:up      # start PostgreSQL
npm test           # run the suite
npm run report     # suite + coverage against both gates
```

| File | Covers |
|---|---|
| `test/groups.spec.ts` | Group CRUD, uniqueness, delete rules |
| `test/items.spec.ts` | Item CRUD, filters, **the QUERY endpoint**, discontinuation |
| `test/movements.spec.ts` | IN, OUT, insufficient stock, **concurrency**, the CHECK constraint |
| `test/errors.spec.ts` | Error shape, database error mapping, no leaks in production |
| `test/app.spec.ts` | Health check, OpenAPI document, demo data consistency |

### Coverage

| Metric | Achieved | Test gate | Production gate |
|---|---|---|---|
| Statements | **99.3%** | 60% | 85% |
| Lines | **99.7%** | 60% | 85% |
| Functions | **100%** | 60% | 85% |
| Branches | **90.5%** | 60% | 85% |

The gate is Jest itself:

```ts
// jest.config.ts
const COVERAGE_MIN = Number(process.env.COVERAGE_MIN ?? 85);
coverageThreshold: { global: { lines: COVERAGE_MIN, /* ... */ } }
```

Jest exits non-zero when a test fails **or** coverage falls short. That non-zero exit is what stops the pipeline. There is no `|| true` and no ignored exit code anywhere.

---

## CI/CD

Two GitHub Actions pipelines. Each is two jobs: one builds and verifies, the
other deploys to Render.

```
job: pipeline                     ->    job: deploy
  install                                 needs: pipeline
  lint                                    |
  build                                   tell Render which image to run
  gate 1: 0 failing tests                 wait for the rollout to finish
  gate 2: coverage >= 60% / 85%           ask the live service what it is running
  docker build
  publish the image to GHCR
```

`needs: pipeline` is what makes the gates binding: if either gate fails, the
first job fails and the deploy job never starts. A pull request builds and
publishes, but never deploys.

### The two quality gates

Each one is its own step, so a red pipeline says which rule stopped it.

| Gate | Step | Enforced by | Fails when |
|---|---|---|---|
| **0 failing tests** | `npm test` | Jest's exit code | any test fails — or no tests are found at all, so the gate cannot be passed by deleting the suite |
| **Coverage** | `npm run test:cov` | Jest's `coverageThreshold` | any metric is below `COVERAGE_MIN`, which is the only difference between the two pipeline files: `60` and `85` |

There is no `|| true`, no `continue-on-error` and no ignored exit code anywhere.

### How the deployment is verified

Every image is stamped at build time with the commit it came from:

```dockerfile
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
```

`/health` reports it, so the last step of the deploy does not assume the
rollout worked — it asks:

```bash
body=$(curl -fsS "${SERVICE_URL}/health")
revision=$(echo "$body" | jq -r '.revision')
[ "$revision" = "${GITHUB_SHA}" ]      # otherwise the job fails
```

A deployment that silently kept the previous version therefore fails the
pipeline instead of reporting a success it did not achieve. The image is also
pushed under its commit sha and deployed by that tag rather than by `:test` or
`:prod`, so a deployment is reproducible and can be rolled back to a known
build.

### What the pipelines need

Each GitHub Environment (`test`, `production`) carries the credentials of its
own Render service. Nothing else is stored in the repository.

| Name | Kind | What it is |
|---|---|---|
| `RENDER_API_KEY` | secret | Render API key, used to trigger and poll the deploy |
| `RENDER_SERVICE_ID` | secret | id of that environment's Render service (`srv-…`) |
| `RENDER_SERVICE_URL` | variable | public URL of that service, used for the health check |
