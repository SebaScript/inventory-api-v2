# Inventory API

RESTful inventory API with NestJS + TypeScript + PostgreSQL, containerised with Docker and guarded by two CI/CD pipelines with coverage gates.

```bash
git clone https://github.com/SebaScript/inventory-api-v2.git
cd inventory-api-v2

npm run docker:dev    # DEV   -> docker compose up --build
npm run docker:test   # TEST  -> docker compose --env-file .env.test up --build -d
npm run docker:prod   # PROD  -> docker compose --env-file .env.production up --build -d
```

| | Local | Test | Production |
|---|---|---|---|
| API | :3000 | :3100 | :3200 |
| PostgreSQL | :5432 | :5433 | :5434 |
| Env file | `.env` | `.env.test` | `.env.production` |
| Database | `inventory_dev` | `inventory_test` | `inventory_prod` |
| Credentials | dev defaults | own | own |
| Demo data | yes | yes | no |

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

### Postman

`postman/` holds a collection covering every endpoint, plus one environment per
deployment. Import the four files, pick an environment, and **Run collection**:
the folders run in order and each request carries tests, so a green run means
the API behaved. Folder 5 sends requests that are meant to fail — that is where
the business rules are visible. See `postman/README.md`.

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
Group  0..N --classifies-- 1..1  Item  0..N --registers-- 1..1  Movement
```

TypeORM creates the schema from the entity classes at startup, so the entities are the single source of truth and there is nothing to keep in step with them. `docker compose down -v` rebuilds everything from zero.

| Rule | Why |
|---|---|
| `UNIQUE` name on groups | One category per name; the API also compares case-insensitively |
| `UNIQUE` sku (stored uppercase) | Makes SKU uniqueness real, not cosmetic |
| `CHECK (quantity >= 0)` | The invariant's last line of defence |
| `CHECK (quantity > 0)` on movements | Direction comes from `type`, never from a sign |
| `ON DELETE RESTRICT` groups → items | Deleting a category must not destroy inventory |
| `ON DELETE RESTRICT` items → movements | A movement can never be orphaned; history is permanent |

**The demo data is deterministic and self-consistent.** Items are created empty and their stock is built by applying the movements, so the ledger explains the stock by construction. 3 groups, 6 items, 10 movements — including an item below its minimum and one at zero, so the low-stock filter has something to show. It loads on startup when `SEED=true`, and never in production.

---

## Environments

Two independent environments, plus local development, all from **one `docker-compose.yml`**. What separates them is the env file: it sets the compose project name (so Docker treats each as its own stack with its own containers, network and volume), the ports, and the database credentials.

```bash
cp .env.test.example .env.test              # set a real password
cp .env.production.example .env.production

npm run docker:test    # :3100
npm run docker:prod    # :3200
```

All three can run at once without colliding. Production starts with an empty inventory: `SEED=false`, and the application refuses to seed when `NODE_ENV=production` even if it were set.

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

Two GitHub Actions pipelines. Each is two jobs: one builds and verifies, the other deploys.

```
job: pipeline  (GitHub runner)        job: deploy  (self-hosted runner)
  install                               needs: pipeline
  lint                                  |
  build                                 pull the published image
  gate 1: 0 failing tests               restart the stack with it
  gate 2: coverage >= 60% / 85%         verify /health answers
  docker build                          verify the running image is that one
  publish the image to GHCR  ──────────►
```

`needs: pipeline` is what makes the gates binding: if either gate fails the
first job fails, and the deploy job never starts.

### Why the deploy job runs on a self-hosted runner

The Test and Production stacks run on a host GitHub cannot reach, so the host
reaches out instead: a self-hosted runner registered on that machine picks up
the deploy job, pulls the tag the pipeline just published, and restarts the
stack with it.

Nothing is ever built on the host. The environment runs the exact image that
cleared the quality gates — `docker-compose.yml` takes the tag from `API_IMAGE`:

```yaml
  api:
    image: ${API_IMAGE:-inventory-api:dev}   # :test / :prod in each env file
    build: .                                  # only local development builds
```

The last step proves the deployment actually happened, rather than assuming it:

```powershell
$expected = docker image inspect --format '{{.Id}}' ghcr.io/…:prod
$cid      = docker compose --env-file .env.production ps -q api
$running  = docker inspect --format '{{.Image}}' $cid
if ($expected -ne $running) { exit 1 }
```

If the restart silently kept the old container, the digests differ and the
deployment fails instead of reporting a success it did not achieve.

### Where the secrets live

Each environment is a **GitHub Environment** (`test`, `production`) holding its
own `ENV_FILE` secret with that environment's ports, database name, credentials
and image tag. The repository contains only the `.env.*.example` templates. The
deploy job writes the file, uses it, and deletes it.

### Reproducing the deployment host

The deploy job needs a machine that runs the environments and a runner
registered on it:

1. **Register the runner** — repository *Settings → Actions → Runners → New
   self-hosted runner*, then run the commands GitHub shows. Answer **N** to
   "run as service": Docker Desktop exposes its daemon per user, and a service
   running as `NETWORK SERVICE` cannot reach it. Start it with `run.cmd`.
2. **Create the environments** — *Settings → Environments*, one named `test`
   and one named `production`, each with an `ENV_FILE` secret holding that
   environment's configuration (the `.env.*.example` files are the template,
   plus the `API_IMAGE` line).

The deploy steps are written in PowerShell rather than bash: on a Windows
runner `bash` resolves to the WSL launcher stub, while Git Bash sits outside
`PATH`.

> PostgreSQL only applies `POSTGRES_PASSWORD` when it initialises an empty data
> directory. If an environment's volume already exists, `DB_PASSWORD` in the
> secret must match the password that volume was created with — otherwise the
> API starts, fails to authenticate, and the deployment is rejected.

Both run the suite against a real PostgreSQL service container. `COVERAGE_MIN` is the only difference between the two files: `60` in one, `85` in the other.

### The two quality gates

Each one is its own step, so the pipeline log says which rule stopped it.

| Gate | Step | Enforced by | Fails when |
|---|---|---|---|
| **0 failing tests** | `npm test` | Jest's exit code | any test fails — or no tests are found at all, so the gate cannot be passed by deleting the suite |
| **Coverage** | `npm run test:cov` | Jest's `coverageThreshold` | any metric is below `COVERAGE_MIN` |

Both were verified by making them fail on purpose:

```bash
# a single failing test
$ npm test
Tests: 1 failed, 28 passed, 29 total          -> exit 1

# no tests at all
$ npm test
No tests found, exiting with code 1           -> exit 1

# coverage below the bar
$ COVERAGE_MIN=99 npm run test:cov
Jest: Coverage for branches (90.51%) does not
      meet "global" threshold (99%)           -> exit 1
```

A step that exits non-zero ends the job, and `Deploy` is the last step — so neither gate can be missed and still reach a deployment. There is no `|| true`, no `continue-on-error` and no ignored exit code anywhere.
