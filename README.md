# Inventory API

A production-grade RESTful inventory management API built with **NestJS**, **TypeScript** and **PostgreSQL**, fully containerised with Docker and guarded by two independent CI/CD pipelines.

The domain is three entities — **Group → Item → Movement** — with strict transactional stock rules: an item's quantity is always exactly the sum of its movement ledger, and it can never go negative, not even under concurrent load.

```bash
git clone https://github.com/SebaScript/inventory-api.git
cd inventory-api
docker compose up --build
```

| Service | URL                             |
| ------- | ------------------------------- |
| API     | http://localhost:3000           |
| Swagger | http://localhost:3000/docs      |
| Health  | http://localhost:3000/health    |

---

## Table of contents

- [Project overview](#project-overview)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Docker](#docker)
- [PostgreSQL](#postgresql)
- [Migrations](#migrations)
- [Seed](#seed)
- [API reference](#api-reference)
- [Swagger](#swagger)
- [The QUERY endpoint](#the-query-endpoint)
- [Pagination, filtering and sorting](#pagination-filtering-and-sorting)
- [Error handling](#error-handling)
- [Testing](#testing)
- [Coverage](#coverage)
- [CI/CD](#cicd)
- [Test environment](#test-environment)
- [Production environment](#production-environment)
- [Deployment](#deployment)
- [Git workflow](#git-workflow)

---

## Project overview

The API manages an inventory made of three related entities:

- **Group** — a category items belong to. Names are unique case-insensitively.
- **Item** — a stock keeping unit. Its `quantity` is **read-only** through the item endpoints.
- **Movement** — an append-only ledger entry (`IN` or `OUT`) that is the *only* way stock ever changes.

### The central invariant

> `item.quantity` always equals `sum(IN) − sum(OUT)` for that item, and is never negative.

Three mechanisms uphold it together:

1. **Stock is never edited directly.** `PUT`/`PATCH` on an item reject a `quantity` field with a `400`, pointing the caller at `POST /movements`. Even opening stock supplied at creation is recorded as an opening `IN` movement in the same transaction, so there is no unexplained starting balance.
2. **Movement creation is atomic.** The ledger entry and the new stock value are written inside one database transaction. There is no interleaving where one exists without the other.
3. **Concurrency is handled correctly.** The item row is read with `SELECT … FOR UPDATE`. Without that lock, two simultaneous `OUT` requests could both read the same stock, both conclude they fit, and both commit — overselling the item. The lock serialises them, so the second correctly fails.

On top of that, a `CHECK (quantity >= 0)` constraint in PostgreSQL is the last line of defence: even a bug in the service layer or a manual `UPDATE` cannot drive stock negative. Both layers are tested — see [`test/integration/inventory-transaction.int-spec.ts`](test/integration/inventory-transaction.int-spec.ts).

---

## Tech stack

| Concern            | Choice                          | Why                                                                                        |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Runtime            | Node.js 24 LTS                  | Its HTTP parser recognises the `QUERY` verb this API exposes (Node 22+).                     |
| Framework          | NestJS 11 (Express 5)           | First-class DI, modular structure, and **native `QUERY` support** via `@QueryMethod`.        |
| Language           | TypeScript 5.9, `strict`        | Compile-time guarantees across the whole domain.                                             |
| Data access        | TypeORM 1.x                     | See the rationale below.                                                                     |
| Database           | PostgreSQL 18                   | Transactions, row locks, `CHECK` constraints, partial and trigram indexes.                   |
| Validation         | class-validator + class-transformer | Declarative DTO validation, wired to one global `ValidationPipe`.                        |
| Configuration      | `@nestjs/config` + Joi          | Environment validated at boot; the app fails fast instead of half-configured.                |
| Documentation      | `@nestjs/swagger`               | OpenAPI 3 served at `/docs`, verified against the real routes by a test.                     |
| Health             | `@nestjs/terminus`              | `/health` reports `503` when PostgreSQL is unreachable.                                      |
| Testing            | Jest 30 + supertest             | Unit, integration and E2E in one run with a single coverage report.                          |
| Local test DB      | `embedded-postgres`             | Real PostgreSQL binaries, so `npm test` works with neither Docker nor a system install.      |
| Container          | Docker multi-stage + Compose    | Reproducible on any machine that has Docker.                                                 |
| CI/CD              | GitHub Actions                  | Two independent pipelines with enforced quality gates.                                       |

### Dependency overrides

`package.json` carries one `overrides` entry, and it exists for a reason worth stating since JSON cannot hold a comment:

```jsonc
"overrides": { "@nestjs/swagger": { "js-yaml": "^5.3.0" } }
```

`@nestjs/swagger@11.4.6` pins `js-yaml` at exactly `5.2.1`, which carries a high-severity denial-of-service advisory ([GHSA-pm4m-ph32-ghv5](https://github.com/advisories/GHSA-pm4m-ph32-ghv5)) fixed in `5.3.0`. No stable `@nestjs/swagger` release bumps it yet, so the transitive dependency is forced forward.

The override is **scoped to `@nestjs/swagger` deliberately**: ESLint and the Nest CLI use the unaffected `js-yaml` v4 line, and a blanket override would drag them across a major version for no benefit.

The Production Pipeline runs `npm audit --omit=dev --audit-level=high` and refuses to deploy if it fails — which is exactly how this advisory was found.

### Why TypeORM

The data-access layer was a deliberate choice, weighed against Prisma and Drizzle:

- **Explicit transaction control with row-level locking.** `dataSource.transaction()` combined with `setLock('pessimistic_write')` produces the `SELECT … FOR UPDATE` the inventory rule needs. This is the requirement that dominates the whole design, and TypeORM expresses it directly.
- **A native repository pattern**, which maps one-to-one onto the data-access layer this project separates out, and which mocks trivially in unit tests.
- **Hand-written, reviewable SQL migrations.** No code generation step, so every constraint and index is visible and auditable, and the schema can be rebuilt from zero deterministically.
- **A simpler, more reliable container build** — there is no generated client or native engine binary to carry between build stages.

---

## Architecture

A layered, modular design. Each layer has one job, and dependencies point in one direction only.

```
HTTP request
    │
    ▼
┌─────────────────┐  Validates and delegates. No business logic.
│   Controller    │  Global ValidationPipe · ParseIntPipe · Swagger decorators
└────────┬────────┘
         ▼
┌─────────────────┐  Business rules. Throws framework-free domain errors,
│    Service      │  never HttpException, so it is testable without NestJS.
└────────┬────────┘
         ▼
┌─────────────────┐  Query construction and persistence. All SQL lives here.
│   Repository    │
└────────┬────────┘
         ▼
┌─────────────────┐  TypeORM entities. Constraints mirrored in the migration.
│     Entity      │
└────────┬────────┘
         ▼
    PostgreSQL

         ▲
         │  Any error thrown at any layer
┌─────────────────────────┐
│ GlobalExceptionFilter   │  One filter, one response shape, one place where
│                         │  domain errors become HTTP status codes.
└─────────────────────────┘
```

**Key decisions:**

- **Domain errors, not HTTP exceptions, in services.** `InsufficientStockError` knows nothing about HTTP. `GlobalExceptionFilter` is the single place that maps it to `409`. The business layer therefore has no transport coupling and is unit-testable without booting NestJS.
- **One global exception filter rather than a stack of per-type filters.** Ordering between multiple global filters is subtle; a single explicit dispatch is deterministic and directly testable.
- **Nested routes live with the resource they return.** `GET /groups/:groupId/items` is declared in the items module, so `GroupsModule` never depends on `ItemsModule` and there is no circular import to work around.
- **Movements are append-only.** No `PUT`, `PATCH` or `DELETE`. Rewriting a ledger entry would break the central invariant; corrections are made with a compensating movement, as real inventory systems do.

---

## Project structure

```
inventory-api/
├── .github/workflows/
│   ├── test-pipeline.yml           # develop → coverage ≥ 60% → deploy Test
│   └── production-pipeline.yml     # main    → coverage ≥ 85% → deploy Production
├── docker/
│   ├── entrypoint.sh               # waits for PostgreSQL, then execs the app
│   └── healthcheck.js              # container HEALTHCHECK, no curl needed
├── scripts/
│   └── smoke-test.sh               # exercises a live deployment end to end
├── src/
│   ├── main.ts                     # bootstrap: pipes, filters, migrations, seed
│   ├── app.module.ts
│   ├── swagger.ts                  # OpenAPI document, incl. the QUERY contract
│   ├── common/
│   │   ├── database/               # numeric column transformer
│   │   ├── decorators/             # reusable Swagger response decorators
│   │   ├── dto/                    # pagination, paginated envelope, error shape
│   │   ├── errors/                 # domain error hierarchy
│   │   └── filters/                # GlobalExceptionFilter
│   ├── config/                     # typed configuration + Joi env schema
│   ├── database/
│   │   ├── data-source.ts          # shared by the app and the migration CLI
│   │   ├── migrations/             # hand-written SQL
│   │   └── seeds/                  # deterministic demo dataset
│   ├── health/
│   └── modules/
│       ├── groups/                 # entity · dto · repository · service · controller
│       ├── items/                  # + the QUERY search endpoint
│       └── movements/              # + the transactional stock rule
└── test/
    ├── setup/                      # embedded PostgreSQL, app factory, QUERY helper
    ├── integration/                # real database: transactions, constraints, seed
    └── e2e/                        # full HTTP surface via supertest
```

---

## Requirements

**To run the project — one requirement:**

- Docker with Compose v2 (Docker Desktop, or Docker Engine + the compose plugin)

**To develop locally without Docker:**

- Node.js ≥ 22 (24 recommended)
- No PostgreSQL install needed: the test suite boots its own via `embedded-postgres`

---

## Quick start

```bash
git clone https://github.com/SebaScript/inventory-api.git
cd inventory-api
docker compose up --build
```

That is the whole setup. No Node.js install, no PostgreSQL install, no manual database creation, no table setup, no external scripts.

```
API       http://localhost:3000
Swagger   http://localhost:3000/docs
Health    http://localhost:3000/health
```

On first boot the container waits for PostgreSQL, applies the migrations and seeds a coherent demo dataset (3 groups, 10 items, 23 movements).

**Try it:**

```bash
curl http://localhost:3000/health
curl http://localhost:3000/items/summary
curl http://localhost:3000/items/low-stock

# The QUERY verb in action
curl -X QUERY http://localhost:3000/items/search \
  -H 'Content-Type: application/json' \
  -d '{"text":"usb","sort":[{"field":"quantity","order":"desc"}]}'
```

**Full reset** — wipes the volume and rebuilds from scratch:

```bash
docker compose down -v && docker compose up --build
```

**Run the smoke test against a live instance:**

```bash
bash scripts/smoke-test.sh http://localhost:3000
```

### Local development without Docker

```bash
npm install
npm test              # boots its own PostgreSQL; no install required
npm run lint
npm run typecheck
npm run build
```

To run the API itself outside Docker you need a PostgreSQL instance; point `DATABASE_URL` at it, then:

```bash
cp .env.example .env    # edit DATABASE_URL to reach your database
npm run migration:run
npm run seed
npm run start:dev
```

---

## Environment variables

Copy the template for the environment you want and fill it in. **No `.env` file is ever committed** — `.gitignore` allows only the `*.example` templates.

| Variable                  | Required | Default       | Description                                                     |
| ------------------------- | :------: | ------------- | --------------------------------------------------------------- |
| `NODE_ENV`                |          | `development` | `development` \| `test` \| `production`                          |
| `PORT`                    |          | `3000`        | Port the API listens on inside the container                     |
| `DATABASE_URL`            |   yes    | —             | Full PostgreSQL connection string                                |
| `DB_SSL`                  |          | `false`       | Enable TLS to the database                                       |
| `DB_LOGGING`              |          | `false`       | Log every SQL statement                                          |
| `DB_POOL_SIZE`            |          | `10`          | Max pooled connections per instance                              |
| `RUN_MIGRATIONS_ON_START` |          | `false`       | Apply pending migrations during bootstrap                        |
| `SEED_ON_START`           |          | `false`       | Insert demo data on boot. **Ignored in production.**             |
| `SWAGGER_ENABLED`         |          | `true`        | Serve the API reference at `/docs`                               |
| `CORS_ORIGIN`             |          | `*`           | `*` or a comma-separated list of origins                         |
| `LOG_LEVEL`               |          | `log`         | `error` \| `warn` \| `log` \| `debug` \| `verbose`               |

Consumed by the PostgreSQL container only: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `API_PORT`.

Every variable is validated by a Joi schema at boot ([`src/config/env.validation.ts`](src/config/env.validation.ts)). An invalid or missing value stops the process immediately with a clear message, rather than failing later on the first request.

Templates: [`.env.example`](.env.example) · [`.env.test.example`](.env.test.example) · [`.env.production.example`](.env.production.example)

---

## Docker

### The image

A four-stage build, so the runtime image ships only compiled JavaScript and production dependencies — no TypeScript compiler, no test framework, no source:

| Stage       | Purpose                                        |
| ----------- | ---------------------------------------------- |
| `deps`      | Full dependency tree from the lockfile          |
| `build`     | Compile TypeScript to `dist/`                   |
| `prod-deps` | `npm ci --omit=dev`                             |
| `runner`    | `node:24-alpine` + `dist` + production deps     |

The runtime container:

- runs as the unprivileged **`node`** user, never root;
- uses **`dumb-init` as PID 1**, so `SIGTERM` reaches Node and `docker compose down` does not sit out the kill timeout;
- declares a **`HEALTHCHECK`** implemented in Node rather than installing `curl` purely to probe itself. It calls the same `/health` endpoint clients use, so a *healthy* container is one that can actually reach PostgreSQL.

### The three stacks

| Stack          | File                       | Project          | API port | DB port  | Volume                 | Seeds |
| -------------- | -------------------------- | ---------------- | -------- | -------- | ---------------------- | ----- |
| **Local/demo** | `docker-compose.yml`       | `inventory-dev`  | **3000** | 5432     | `inventory_dev_pgdata` | yes   |
| **Test**       | `docker-compose.test.yml`  | `inventory-test` | 3100     | 5433     | `inventory_test_pgdata`| yes   |
| **Production** | `docker-compose.prod.yml`  | `inventory-prod` | 3200     | *closed* | `inventory_prod_pgdata`| no    |

Each stack has its own compose project, PostgreSQL container, named volume, network and credentials. **All three can run simultaneously without colliding**, and Test has no route to the production database.

```bash
npm run docker:dev          # → :3000
npm run docker:test         # → :3100
npm run docker:prod         # → :3200 (detached)

npm run docker:dev:down     # add :down to any of them to stop and wipe the volume
```

> **Why the npm scripts exist.** `env_file:` inside a service only injects variables *into the container*. Compose's own `${VAR}` substitution is a separate mechanism that defaults to reading `.env`. Running `docker compose -f docker-compose.test.yml up` without `--env-file .env.test` would therefore silently start the Test stack with **development credentials**. The scripts pass the flag correctly.

---

## PostgreSQL

Exactly three tables, plus TypeORM's migration bookkeeping.

```
┌──────────────────┐        ┌─────────────────────┐        ┌──────────────────────┐
│      groups      │ 1    N │        items        │ 1    N │      movements       │
├──────────────────┤◄───────┼─────────────────────┤◄───────┼──────────────────────┤
│ id               │        │ id                  │        │ id                   │
│ name             │        │ group_id      ──────┘        │ item_id        ──────┘
│ description      │        │ name                │        │ type  (IN | OUT)     │
│ created_at       │        │ description         │        │ quantity             │
│ updated_at       │        │ sku                 │        │ reason               │
└──────────────────┘        │ quantity            │        │ resulting_stock      │
                            │ minimum_stock       │        │ created_at           │
                            │ unit_price          │        └──────────────────────┘
                            │ created_at          │
                            │ updated_at          │
                            └─────────────────────┘
     ON DELETE RESTRICT                  ON DELETE CASCADE
```

### Integrity

| Constraint                      | Rule                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `ux_groups_name_lower`          | Unique index on `lower(name)` — "Tools" and "tools" collide       |
| `chk_groups_name_length`        | Trimmed name between 2 and 80 characters                          |
| `ux_items_sku`                  | Globally unique SKU (stored uppercase)                            |
| `chk_items_quantity`            | `quantity >= 0` — **the invariant's last line of defence**        |
| `chk_items_minimum_stock`       | `minimum_stock >= 0`                                              |
| `chk_items_unit_price`          | `unit_price >= 0`                                                 |
| `fk_items_group`                | `ON DELETE RESTRICT` — deleting a non-empty group returns `409`   |
| `chk_movements_quantity`        | `quantity > 0` — direction is carried by `type`, not by a sign    |
| `chk_movements_resulting_stock` | `resulting_stock >= 0`                                            |
| `fk_movements_item`             | `ON DELETE CASCADE` — no orphan ledger rows                       |

### Indexes

| Index                              | Serves                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| `idx_items_group_id`               | Filtering items by group                                          |
| `idx_items_name_trgm` (GIN)        | `ILIKE` free-text search, from an index rather than a scan        |
| `idx_items_sku_trgm` (GIN)         | Same, for SKUs                                                    |
| `idx_items_low_stock` (partial)    | `GET /items/low-stock` — indexes only the rows that qualify       |
| `idx_movements_item_id_created_at` | An item's ledger, newest first                                    |
| `idx_movements_type`               | Filtering by direction                                            |
| `idx_movements_created_at`         | Date-range filtering                                              |

Two further design notes:

- **`movements.resulting_stock`** records the stock level immediately after each entry. It makes the ledger auditable and lets stock history be read directly instead of replayed row by row.
- **`updated_at` is maintained by a database trigger** (`set_updated_at`), so it stays truthful even for writes that bypass the ORM.

---

## Migrations

Written by hand as explicit SQL rather than generated, so every constraint and index is reviewable, and `down()` is exhaustive — which is what makes "rebuild the database from zero" a testable claim rather than an assumption.

`synchronize` is **`false` in every environment, without exception**. Structural changes only ever go through a reviewed migration.

```bash
npm run migration:run       # apply pending migrations
npm run migration:show      # list applied and pending
npm run migration:revert    # roll the last one back
```

Inside a container, migrations are applied automatically on boot when `RUN_MIGRATIONS_ON_START=true`, which all three stacks set. The application is the single owner of that logic, so it behaves identically in Docker and out of it.

---

## Seed

A fixed, deterministic dataset — **3 groups, 10 items, 23 movements** — with no randomness anywhere. The same `docker compose up` always produces the same numbers, so the examples in this README, the smoke tests and a live demonstration all agree.

Two properties make it trustworthy rather than decorative:

1. **Stock is computed, never hard-coded.** Items are created with zero stock and every movement is applied with the same arithmetic the API uses. The dataset therefore cannot drift out of agreement with its own ledger; the invariant holds by construction, and an integration test asserts it for every item.
2. **It is idempotent.** Running it twice does nothing the second time, so a container restart never duplicates demo data.

The dataset deliberately produces every scenario worth demonstrating:

| Scenario           | Example                                          |
| ------------------ | ------------------------------------------------ |
| Healthy stock      | `ELEC-USBC-2M` — 85 units, minimum 20            |
| Low stock          | `ELEC-KBD-TKL` — 8 units, minimum 10             |
| Out of stock       | `ELEC-HUB-7IN1` — 0 units                        |
| Mixed history      | `WHSE-GLOVES-L5` — one IN and two OUT movements  |

```bash
npm run seed             # no-op if data already exists
npm run seed -- --force  # wipe and repopulate, resetting id sequences
```

Resulting summary:

```jsonc
{
  "totalGroups": 3, "totalItems": 10, "totalUnits": 562,
  "totalValue": 9374.35, "lowStockCount": 3, "outOfStockCount": 1
}
```

---

## API reference

### Groups

| Method   | Path                       | Description                                       | Success |
| -------- | -------------------------- | ------------------------------------------------- | ------- |
| `POST`   | `/groups`                  | Create a group                                    | `201`   |
| `GET`    | `/groups`                  | List — paginated, searchable, sortable            | `200`   |
| `GET`    | `/groups/:id`              | Get one                                           | `200`   |
| `PUT`    | `/groups/:id`              | Replace (omitted fields are cleared)              | `200`   |
| `PATCH`  | `/groups/:id`              | Partial update                                    | `200`   |
| `DELETE` | `/groups/:id`              | Delete — `409` while it still holds items         | `204`   |
| `GET`    | `/groups/:groupId/items`   | Items belonging to a group                        | `200`   |

### Items

| Method   | Path                       | Description                                       | Success |
| -------- | -------------------------- | ------------------------------------------------- | ------- |
| `POST`   | `/items`                   | Create — optional opening stock                   | `201`   |
| `GET`    | `/items`                   | List — paginated, filterable, sortable            | `200`   |
| `GET`    | `/items/low-stock`         | At or below minimum, most urgent first            | `200`   |
| `GET`    | `/items/summary`           | Inventory totals and per-group breakdown          | `200`   |
| **`QUERY`** | **`/items/search`**     | **Advanced structured search**                    | `200`   |
| `POST`   | `/items/search`            | Interoperability alias for the above              | `200`   |
| `GET`    | `/items/:id`               | Get one, with its group                           | `200`   |
| `PUT`    | `/items/:id`               | Replace (stock is preserved)                      | `200`   |
| `PATCH`  | `/items/:id`               | Partial update                                    | `200`   |
| `DELETE` | `/items/:id`               | Delete, cascading its ledger                      | `204`   |
| `GET`    | `/items/:itemId/movements` | The item's stock history                          | `200`   |

> `quantity` is rejected with `400` on `PUT` and `PATCH`. Stock belongs to the ledger — use `POST /movements`.

### Movements

| Method | Path             | Description                                        | Success |
| ------ | ---------------- | -------------------------------------------------- | ------- |
| `POST` | `/movements`     | Record a movement — transactional, `409` if short   | `201`   |
| `GET`  | `/movements`     | List — filter by `itemId`, `type`, `from`, `to`     | `200`   |
| `GET`  | `/movements/:id` | Get one                                             | `200`   |

There is deliberately no `PUT`, `PATCH` or `DELETE`: the ledger is append-only.

### Health

| Method | Path      | Description                                        | Success        |
| ------ | --------- | -------------------------------------------------- | -------------- |
| `GET`  | `/health` | Reports `503` when PostgreSQL is unreachable        | `200` / `503`  |

```jsonc
{ "status": "ok", "info": { "database": { "status": "up" } },
  "error": {}, "details": { "database": { "status": "up" } } }
```

### Examples

```bash
# Create a group and an item with opening stock
GROUP=$(curl -sX POST localhost:3000/groups \
  -H 'Content-Type: application/json' \
  -d '{"name":"Peripherals","description":"Input devices"}')

curl -X POST localhost:3000/items -H 'Content-Type: application/json' \
  -d '{"groupId":1,"name":"Trackball","sku":"PER-TRACK-1","quantity":30,"minimumStock":5,"unitPrice":59.9}'

# Stock in, then out
curl -X POST localhost:3000/movements -H 'Content-Type: application/json' \
  -d '{"itemId":1,"type":"IN","quantity":25,"reason":"Supplier delivery #4471"}'

curl -X POST localhost:3000/movements -H 'Content-Type: application/json' \
  -d '{"itemId":1,"type":"OUT","quantity":10,"reason":"Sales order SO-1001"}'

# An OUT larger than stock → 409, and nothing is written
curl -X POST localhost:3000/movements -H 'Content-Type: application/json' \
  -d '{"itemId":1,"type":"OUT","quantity":99999}'
```

```jsonc
// 409 Conflict
{
  "statusCode": 409, "error": "Conflict", "code": "INSUFFICIENT_STOCK",
  "message": "Insufficient stock for item 1: 100 unit(s) available, 99999 requested",
  "details": { "itemId": 1, "available": 100, "requested": 99999 },
  "path": "/movements", "method": "POST",
  "timestamp": "2026-08-16T21:51:09.741Z",
  "requestId": "1e625d71-2b86-424d-817d-abbefdd78fb0"
}
```

---

## Swagger

Interactive OpenAPI 3 reference at **http://localhost:3000/docs** (raw document at `/docs-json`).

It documents endpoints, parameters, request bodies, responses, **error shapes** and status codes — not just happy paths. A dedicated test suite ([`test/e2e/swagger.e2e-spec.ts`](test/e2e/swagger.e2e-spec.ts)) compares the generated document against the real routes, so the published reference cannot silently drift from the implementation.

---

## The QUERY endpoint

**`QUERY /items/search`** — advanced inventory search.

### What QUERY is

HTTP `QUERY` ([draft-ietf-httpbis-safe-method-w-body](https://datatracker.ietf.org/doc/draft-ietf-httpbis-safe-method-w-body/)) is a method that is **safe and idempotent like `GET`, but carries a request body**.

### Why this endpoint uses it

The filter is a **nested structure**: an array of group ids, two inclusive ranges, and an ordered list of sort criteria.

- **`GET` is a poor fit.** Encoding arrays and nested objects into a query string means inventing an ad-hoc encoding, and it runs into URL length limits as soon as a caller filters on many groups.
- **`POST` is semantically wrong.** It tells caches, proxies and every reader of the API that the request changes state. This one only reads.

`QUERY` is the method designed for exactly this case, so this is a real use case rather than a checkbox.

### How it is implemented

**Natively, with no routing hacks.** The whole chain supports the verb:

```
@QueryMethod('search')          →  @nestjs/common 11.2
  RequestMethod.QUERY           →  mapped by RouterMethodFactory
  AbstractHttpAdapter.query()   →  @nestjs/core
  express.query()               →  Express 5 derives methods from http.METHODS
  llhttp                        →  Node 22+ parses the QUERY method
```

No custom router, no middleware, no method-override header. On boot NestJS logs `Mapped {/items/search, QUERY} route` alongside every other route.

### Request

```http
QUERY /items/search HTTP/1.1
Content-Type: application/json
```

```jsonc
{
  "text": "usb",                    // matches name, SKU and description (trigram-indexed)
  "groupIds": [1, 3],               // up to 100 ids
  "price": { "min": 5, "max": 200 },
  "stock": { "min": 0, "max": 100 },
  "lowStockOnly": false,
  "sort": [                          // applied left to right, up to 4 criteria
    { "field": "quantity", "order": "asc" },
    { "field": "name", "order": "asc" }
  ],
  "page": 1,
  "pageSize": 20                     // capped at 100
}
```

Every field is optional; an empty body `{}` returns the first page of all items.

### Response `200 OK`

```jsonc
{
  "data": [
    {
      "id": 1, "groupId": 1, "name": "USB-C Cable 2m", "sku": "ELEC-USBC-2M",
      "quantity": 85, "minimumStock": 20, "unitPrice": 12.5,
      "createdAt": "2026-08-16T10:00:00.000Z", "updatedAt": "2026-08-16T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1,
    "hasNextPage": false, "hasPreviousPage": false
  }
}
```

Validation failures return `400` in the standard error shape, with the offending fields in `details.validationErrors`.

### How to test it

```bash
# curl sends any method verbatim with -X, so this is a genuine QUERY request
curl -X QUERY http://localhost:3000/items/search \
  -H 'Content-Type: application/json' \
  -d '{"text":"usb","sort":[{"field":"quantity","order":"desc"}]}'
```

```bash
# Every filter at once
curl -X QUERY http://localhost:3000/items/search \
  -H 'Content-Type: application/json' \
  -d '{"text":"usb","groupIds":[1],"price":{"min":5,"max":200},
       "stock":{"min":0,"max":500},"lowStockOnly":false,
       "sort":[{"field":"unitPrice","order":"asc"}],"page":1,"pageSize":10}'
```

Automated coverage lives in [`test/e2e/items-query.e2e-spec.ts`](test/e2e/items-query.e2e-spec.ts) — 13 tests that issue the **real verb** over a real socket, plus a check in `scripts/smoke-test.sh` that runs against every deployed container in CI.

### Swagger and the POST alias

OpenAPI 3.0 defines a **closed set** of operations (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`) that does not include `query`. No decorator configuration can make Swagger UI render this operation — that is a limitation of the specification, not of the implementation.

Rather than hide the endpoint, three things compensate:

1. Its full contract is published in the Swagger page description.
2. Its request schemas (`SearchItemsDto`, `RangeFilterDto`, `SortCriterionDto`) are registered as extra models, so they appear under **Schemas**.
3. **`POST /items/search`** is exposed as an interoperability alias — identical body, identical response, identical handler — clearly labelled as such, so tooling that cannot emit `QUERY` can still reach the feature. **The canonical verb is `QUERY`.**

---

## Pagination, filtering and sorting

Every list endpoint returns the same envelope and accepts the same core parameters.

```
GET /items?page=1&pageSize=20&groupId=1&sortBy=name&sortOrder=asc
```

| Parameter   | Default | Notes                                              |
| ----------- | ------- | -------------------------------------------------- |
| `page`      | `1`     | 1-based                                            |
| `pageSize`  | `20`    | **Hard maximum 100** — unbounded results are impossible |
| `sortBy`    | `id`    | Restricted to a per-resource enum                  |
| `sortOrder` | `asc`   | `asc` \| `desc`                                    |

Resource-specific filters:

| Resource    | Filters                                                        |
| ----------- | -------------------------------------------------------------- |
| Groups      | `search`                                                        |
| Items       | `search`, `groupId`, `minPrice`, `maxPrice`, `lowStock`          |
| Movements   | `itemId`, `type`, `from`, `to` (ISO-8601)                        |

> **Why `sortBy` is an enum.** A validated enum is the only value that ever reaches the `ORDER BY` clause, which makes ordering injection-proof by construction rather than by escaping. `GET /groups?sortBy=name;DROP TABLE groups` returns `400`.

Every response also carries a stable id tiebreaker in its ordering, so rows with equal sort keys cannot shuffle between pages and produce duplicates or gaps.

---

## Error handling

One shape for every failure, from any layer:

```jsonc
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "INSUFFICIENT_STOCK",     // branch on this, not on `message`
  "message": "Insufficient stock for item 4: 3 unit(s) available, 10 requested",
  "details": { "itemId": 4, "available": 3, "requested": 10 },
  "path": "/movements",
  "method": "POST",
  "timestamp": "2026-08-16T21:51:09.741Z",
  "requestId": "1e625d71-2b86-424d-817d-abbefdd78fb0"
}
```

### Status codes

| Code  | When                                                                     |
| ----- | ------------------------------------------------------------------------ |
| `200` | Successful read, update or replace                                        |
| `201` | Resource created                                                          |
| `204` | Deleted, no body                                                          |
| `400` | Validation failure — body, path param, query param, enum, format          |
| `404` | Referenced resource does not exist                                        |
| `409` | Conflict: duplicate name/SKU, non-empty group, **insufficient stock**     |
| `422` | Well formed but violates a database integrity rule                        |
| `500` | Unexpected internal error                                                 |
| `503` | Health check degraded: PostgreSQL unreachable                             |

### Error codes

`GROUP_NOT_FOUND` · `ITEM_NOT_FOUND` · `MOVEMENT_NOT_FOUND` · `GROUP_NAME_ALREADY_EXISTS` · `SKU_ALREADY_EXISTS` · `GROUP_NOT_EMPTY` · `INSUFFICIENT_STOCK` · `VALIDATION_FAILED` · `FOREIGN_KEY_VIOLATION` · `CHECK_CONSTRAINT_VIOLATION` · `DATABASE_ERROR` · `INTERNAL_SERVER_ERROR`

### What is never exposed

In **production** an unexpected error becomes a generic `500` — `"An unexpected internal error occurred"`. The real message, the stack trace and the failing SQL go to the server log only, correlated with the response by `requestId`. This is tested explicitly: a thrown error containing a connection string with a password must not appear anywhere in the response body, and the production pipeline fails if a deployed container returns a `stack` field.

Outside production the stack trace *is* included, because local debugging should be pleasant.

Database errors are translated rather than leaked: `23505` → `409`, `23503` → `409`, `23514` → `422`, `22P02` → `400`. A constraint violation never surfaces as an opaque `500`.

---

## Testing

357 tests across three layers, run together in a single command with one merged coverage report.

```bash
npm test                  # everything
npm run test:unit         # unit only — no database needed
npm run test:integration  # real PostgreSQL
npm run test:e2e          # full HTTP surface
npm run test:cov          # with the coverage gate
```

**No PostgreSQL installation is required.** `test/setup/global-setup.ts` uses `DATABASE_URL` when one is set (CI, Docker) and otherwise boots an ephemeral PostgreSQL through `embedded-postgres`. The schema is created by running the **real migrations**, so tests exercise the exact schema production runs on.

### Unit — 188 tests

Inventory arithmetic (extracted as a pure function and tested exhaustively), all three services with mocked repositories, domain errors, DTO validation, environment parsing, seed guards, and every branch of the exception filter.

### Integration — 38 tests, real PostgreSQL

- The transaction **rolls back completely** on insufficient stock: no movement, no stock change.
- **Concurrency**: two simultaneous `OUT` movements of 60 against stock of 100 — exactly one succeeds. *This test fails without the row lock*, which is what makes the lock demonstrably necessary rather than defensive decoration.
- `CHECK` constraints reject negative stock **even when the service layer is bypassed with raw SQL**.
- Referential integrity: `RESTRICT` on groups, `CASCADE` on movements, the full relationship graph.
- The schema really contains the expected indexes, trigger, `pg_trgm` extension and exactly three tables.
- The seed leaves every item's stock equal to the net of its ledger, and is idempotent and deterministic.

### E2E — 131 tests, full application over HTTP

Group CRUD, Item CRUD, `IN`, `OUT`, insufficient stock, validation across body/params/query, pagination and its cap, the ledger's append-only rule, health degradation and recovery, the **QUERY verb driven over a real socket**, and the OpenAPI document checked against the real routes.

---

## Coverage

| Metric     | Achieved   | Test gate | Production gate |
| ---------- | ---------- | --------- | --------------- |
| Lines      | **100%**   | 60%       | 85%             |
| Functions  | **100%**   | 60%       | 85%             |
| Statements | **100%**   | 60%       | 85%             |
| Branches   | **95.68%** | 60%       | 85%             |

The gate is Jest itself:

```ts
const COVERAGE_MIN = Number(process.env.COVERAGE_MIN ?? 85);
coverageThreshold: { global: { lines: COVERAGE_MIN, statements: COVERAGE_MIN,
                               functions: COVERAGE_MIN, branches: COVERAGE_MIN } }
```

Jest exits non-zero below the bar, so the same command enforces 60% in the Test pipeline and 85% in the Production pipeline, and a miss stops the chain before deployment.

**Nothing is manipulated to inflate the number.** There is no `|| true`, no `continue-on-error`, no ignored exit code, no disabled test and no `--passWithNoTests`. Only four exclusions, each with a reason:

| Excluded              | Why                                                                            |
| --------------------- | ------------------------------------------------------------------------------ |
| `main.ts`             | Process entry point: wires up and calls `listen`                                |
| `run-seed.ts`         | CLI entry point; the seed logic it calls **is** covered                         |
| `*.module.ts`         | Declarative wiring with no branches; a mistake makes the whole E2E suite fail   |
| `database/migrations` | Verified by every integration test — none could run without the schema they produce |

---

## CI/CD

Two independent GitHub Actions pipelines. Each is a **linear chain of jobs wired with `needs`**, so a failure anywhere structurally prevents everything downstream from running: the deployment simply cannot execute after a red test or a missed coverage bar.

### Test Pipeline — `develop`

```
Checkout → Install → Lint → Format → Type check → Build → Verify output
   ↓
Start PostgreSQL service → Run tests → Coverage ≥ 60%
   ↓
docker compose up --build (Test stack) → wait for health → smoke test
   ↓
Deploy Test → publish ghcr.io/SebaScript/inventory-api:test
```

### Production Pipeline — `main`

```
Checkout → Install → Lint → Format → Type check → Build → npm audit (prod deps)
   ↓
Start PostgreSQL service → Run tests → Coverage ≥ 85%
   ↓
docker compose up --build (Production stack) → verify healthy AND unseeded
   → smoke test → assert no stack traces in responses
   ↓
Deploy Production → publish ghcr.io/SebaScript/inventory-api:prod, :latest, :sha
```

### What makes the gates real

- **Tests and coverage are one step.** Jest's own non-zero exit is the gate; there is no separate "check coverage" script that could be softened.
- **The Docker configuration is genuinely verified on every push.** The `docker` job builds and boots the exact stack that ships, waits for the container healthcheck, then runs `scripts/smoke-test.sh` against the live API — health, both CRUDs, `IN`, `OUT`, insufficient stock rejected atomically, referential integrity, and a real `curl -X QUERY` request.
- **Production additionally proves what must *not* happen**: the stack starts with an empty inventory (demo data can never reach production), and a `404` response carries no `stack` field.
- **Pull requests run every gate but stop before deploying.**

---

## Test environment

Fully independent from Production — the separation is structural, not a convention.

| Aspect      | Value                                                    |
| ----------- | -------------------------------------------------------- |
| URL         | http://localhost:3100 (`/docs`, `/health`)                |
| Stack       | `docker-compose.test.yml`, project `inventory-test`       |
| Database    | Its own PostgreSQL container on port 5433                 |
| Volume      | `inventory_test_pgdata`                                   |
| Network     | `inventory_test_network`                                  |
| Credentials | `.env.test` — never committed                             |
| Secrets     | GitHub environment `test` (`TEST_DB_PASSWORD`)            |
| Seeding     | Enabled — this environment doubles as the QA/demo target  |
| Deployment  | Its own pipeline, triggered by `develop`                  |
| Image       | `ghcr.io/SebaScript/inventory-api:test`                   |

```bash
cp .env.test.example .env.test   # set a real password
npm run docker:test
```

It has no route to the production database: a separate Docker network, separate credentials and a separate volume.

---

## Production environment

| Aspect      | Value                                                     |
| ----------- | --------------------------------------------------------- |
| URL         | http://localhost:3200 (`/docs`, `/health`)                 |
| Stack       | `docker-compose.prod.yml`, project `inventory-prod`        |
| Database    | Its own PostgreSQL container, **port not published**       |
| Volume      | `inventory_prod_pgdata`                                    |
| Network     | `inventory_prod_network`                                   |
| Credentials | `.env.production` — never committed                        |
| Secrets     | GitHub environment `production` (`PRODUCTION_DB_PASSWORD`) |
| Seeding     | **Disabled**, and refused by the application even if set   |
| Deployment  | Its own pipeline, triggered by `main`                      |
| Image       | `ghcr.io/SebaScript/inventory-api:prod`                    |

Additional hardening beyond Test:

- The database port is **not** exposed to the host — it is reachable only from the API container on the internal network.
- Error responses never include stack traces (enforced by a pipeline check).
- CPU and memory limits, plus log rotation, are configured.
- `LOG_LEVEL` defaults to `warn`.

```bash
cp .env.production.example .env.production   # set real secrets
npm run docker:prod
```

**Test and Production share no database, no volume, no network and no secret.** The two `.env` files are separate, both gitignored, and their GitHub Environments hold different secrets.

---

## Deployment

The deliverable of each pipeline is an **immutable, versioned Docker image** published to GitHub Container Registry:

```bash
docker pull ghcr.io/sebascript/inventory-api:prod
docker run -p 3000:3000 -e DATABASE_URL=postgres://... ghcr.io/sebascript/inventory-api:prod
```

Images are tagged `:test` / `:test-<sha>` and `:prod` / `:latest` / `:<sha>`. Publishing uses the built-in `GITHUB_TOKEN` and requires no credentials from anyone, so this part of the pipeline works out of the box.

An image is only ever published from a commit that has already passed lint, formatting, type check, build, the full test suite, the coverage gate and a live smoke test against the real container.

### Rolling out to a hosting platform

Because the deliverable is a plain Docker image, any Docker-capable platform (Render, Fly.io, Railway, Koyeb, a VPS) can run it. That step is **not configured here**, deliberately: it requires an account and API credentials that this repository does not have, and inventing them would be worse than leaving the gap documented.

To enable it:

1. Create the service and a PostgreSQL instance on your platform — **one pair per environment**, so Test and Production stay separate.
2. Add the platform's API token as a secret in the matching GitHub Environment (`test` / `production`).
3. Append a release step to the corresponding `deploy-*` job, after the image push:

   ```yaml
   - name: Trigger platform deployment
     run: curl -fsS -X POST "$DEPLOY_HOOK_URL"
     env:
       DEPLOY_HOOK_URL: ${{ secrets.DEPLOY_HOOK_URL }}
   ```

4. Set `DATABASE_URL`, `NODE_ENV`, `RUN_MIGRATIONS_ON_START=true` and `SEED_ON_START=false` in the platform's own environment configuration.

Nothing else changes: migrations run automatically on boot, and `/health` is ready to serve as the platform's health probe.

---

## Git workflow

Two fixed, long-lived branches. No branch is created per feature.

| Branch    | Role                          | Pipeline            | Coverage gate |
| --------- | ----------------------------- | ------------------- | ------------- |
| `main`    | Production. Always stable.    | Production Pipeline | 85%           |
| `develop` | Integration / Test.           | Test Pipeline       | 60%           |

Work happens on `develop` and is merged into `main` at milestones, once the Test pipeline is green.

### Commit convention

Every commit uses **GitMoji** and is written in English, describing *why* rather than restating the diff.

```
🔧 chore: initialize NestJS + TypeScript project with tooling
🗃️ feat: add domain entities and initial PostgreSQL migration
✨ feat: implement Movement module with atomic stock transactions
🐛 fix: correct low-stock ordering and preserve the health check contract
✅ test: add integration and E2E suites with a real coverage gate
🐳 chore: add multi-stage Docker build and three independent stacks
🚀 ci: add Test and Production pipelines with enforced quality gates
📝 docs: add API documentation and project README
```

| Emoji | Type    | Used for                             |
| ----- | ------- | ------------------------------------ |
| 🔧    | `chore` | Tooling and configuration            |
| ✨    | `feat`  | New functionality                    |
| 🗃️    | `feat`  | Database schema and migrations       |
| 🌱    | `feat`  | Seed data                            |
| 🐛    | `fix`   | Bug fixes                            |
| ✅    | `test`  | Tests                                |
| 🐳    | `chore` | Docker                               |
| 🚀    | `ci`    | Pipelines                            |
| 📝    | `docs`  | Documentation                        |

### Before every commit

`git status` → review the diff → lint, type check and run the relevant tests → confirm no secret is staged → commit with a GitMoji message.

No `.env` file, password, token or key is ever committed. `.gitignore` blocks `.env*` and allows only the `*.example` templates.

---

## License

MIT
