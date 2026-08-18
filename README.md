# Inventory API

RESTful inventory API with **NestJS + TypeScript + PostgreSQL**, containerised with Docker and guarded by two CI/CD pipelines with coverage gates.

Three entities: **Group → Item → Movement**.

```bash
git clone https://github.com/SebaScript/inventory-api-v2.git
cd inventory-api-v2
docker compose up --build
```

| | |
|---|---|
| API | http://localhost:3000 |
| Swagger | http://localhost:3000/docs |
| Health | http://localhost:3000/health |

That is the whole setup — no Node.js or PostgreSQL install needed. Migrations and demo data run automatically on first boot.

---

## Contents

- [The rule that shapes everything](#the-rule-that-shapes-everything)
- [Project structure](#project-structure)
- [API](#api)
- [The QUERY endpoint](#the-query-endpoint)
- [Database](#database)
- [Environments](#environments)
- [Testing and coverage](#testing-and-coverage)
- [CI/CD](#cicd)
- [Git workflow](#git-workflow)

---

## The rule that shapes everything

> **An item's stock always equals the sum of its movements, and is never negative.**

Everything else in the project exists to hold that sentence true.

**1. Stock is never edited directly.** `PUT` and `PATCH` on an item reject a `quantity` field with `400`. The only way stock changes is `POST /movements`. Even opening stock given at creation is written as an `IN` movement, so there is no starting balance the ledger cannot explain.

**2. The write is atomic.** The ledger entry and the new stock value go in one transaction, so one can never exist without the other.

**3. It is safe under concurrency.** The item row is read with `SELECT ... FOR UPDATE`. Without that lock, two simultaneous `OUT` requests would both read the same stock, both conclude they fit, and both commit — 120 units leaving a warehouse that held 100.

```ts
// src/movements/movements.service.ts
return this.dataSource.transaction(async (manager) => {
  const item = await manager
    .createQueryBuilder(Item, 'item')
    .setLock('pessimistic_write')          // ← SELECT ... FOR UPDATE
    .where('item.id = :id', { id: dto.itemId })
    .getOne();

  if (!item) throw new ItemNotFoundException(dto.itemId);

  const resultingStock =
    dto.type === MovementType.IN ? item.quantity + dto.quantity : item.quantity - dto.quantity;

  if (resultingStock < 0) {
    throw new InsufficientStockException(item.id, item.quantity, dto.quantity);
  }

  await manager.update(Item, item.id, { quantity: resultingStock });
  return manager.save(manager.create(Movement, { ...dto, resultingStock }));
});
```

**4. And the database refuses anyway.** `CHECK (quantity >= 0)` means even a bug in the code, or a manual `UPDATE`, cannot drive stock negative. A test proves it by bypassing the application entirely.

---

## Project structure

```
src/
├── main.ts                     bootstrap: pipes, filter, migrations, seed
├── app.module.ts               wiring + environment validation
├── swagger.ts                  the /docs page
├── health.controller.ts        GET /health (queries the database)
├── common/
│   ├── exceptions.ts           business failures as HTTP exceptions
│   ├── http-exception.filter.ts one error shape, no leaks in production
│   └── pagination.ts           page/limit in, {data, meta} out
├── entities/                   Group · Item · Movement
├── groups/                     dto · service · controller · module
├── items/                      idem, plus the QUERY endpoint
├── movements/                  idem, plus the transactional stock rule
└── database/
    ├── data-source.ts          shared by the app and the migration CLI
    ├── migrations/             the schema, as reviewable SQL
    └── seed.ts                 deterministic demo data
```

Each module is four files: **DTO → service → controller → module**. Services use TypeORM's repositories directly (`@InjectRepository`), which is the standard NestJS pattern and removes a layer that would need explaining.

---

## API

### Groups — `/groups`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/groups` | Names are unique, case-insensitively |
| `GET` | `/groups` | `?page`, `?limit`, `?search` |
| `GET` | `/groups/:id` | |
| `PUT` | `/groups/:id` | Replaces — an omitted description is **cleared** |
| `PATCH` | `/groups/:id` | Merges — an omitted description is **kept** |
| `DELETE` | `/groups/:id` | `409` if the group still has items |

### Items — `/items`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/items` | Optional opening stock → recorded as an `IN` movement |
| `GET` | `/items` | `?search`, `?groupId`, `?lowStock` |
| **`QUERY`** | **`/items/search`** | Advanced search — see below |
| `POST` | `/items/search` | Identical alias for clients without QUERY |
| `GET` | `/items/:id` | |
| `PUT` / `PATCH` | `/items/:id` | `quantity` is rejected with `400` |
| `DELETE` | `/items/:id` | Deletes its movements too |

### Movements — `/movements`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/movements` | Transactional. `409` if stock is insufficient |
| `GET` | `/movements` | `?itemId`, `?type` |
| `GET` | `/movements/:id` | |

There is deliberately no `PUT`, `PATCH` or `DELETE`: the ledger is append-only. Corrections are made with an opposite movement.

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
| `409` | Duplicate name/SKU, non-empty group, **insufficient stock** |
| `422` | A database rule was broken |
| `500` | Unexpected — generic message only, details go to the log |
| `503` | Health check: PostgreSQL unreachable |

In production an unexpected error returns only `"Internal server error"`. A test asserts that a thrown error containing a password never appears in the response.

---

## The QUERY endpoint

**`QUERY /items/search`** — advanced search.

`QUERY` is an HTTP method that is **safe and idempotent like `GET`, but carries a request body**.

**Why it fits here.** The filter is a nested structure: a list of group ids plus two price bounds.

```jsonc
{
  "text": "usb",
  "groupIds": [1, 3],
  "minPrice": 5,
  "maxPrice": 200,
  "lowStockOnly": false,
  "page": 1,
  "limit": 20
}
```

- `GET` would need an invented encoding for the array, and hits URL length limits.
- `POST` would tell caches and proxies the request changes state, which is false.

**How it is implemented.** Natively — NestJS 11 ships `@QueryMethod`, Express 5 derives its methods from Node's `http.METHODS`, and Node 22+ parses `QUERY`. No custom routing, no middleware. At boot the log shows `Mapped {/items/search, QUERY} route`.

```ts
@QueryMethod('search')
search(@Body() dto: SearchItemsDto): Promise<Paginated<Item>> {
  return this.service.search(dto);
}
```

**Try it:**

```bash
curl -X QUERY http://localhost:3000/items/search \
  -H 'Content-Type: application/json' \
  -d '{"text":"usb","minPrice":10,"maxPrice":50}'
```

**Why Swagger does not show it.** OpenAPI 3.0 has a closed list of methods that excludes `query` — no configuration can change that. So `POST /items/search` is exposed as an identical alias, clearly labelled, and the QUERY contract is described on the Swagger page.

---

## Database

Three tables. `movement_type` is a PostgreSQL enum, not a table.

```
groups ──1:N──> items ──1:N──> movements
       RESTRICT        CASCADE
```

| Rule | Why |
|---|---|
| `UNIQUE (lower(name))` on groups | "Tools" and "tools" are the same category |
| `UNIQUE` sku (stored uppercase) | Makes SKU uniqueness real, not cosmetic |
| `CHECK (quantity >= 0)` | The invariant's last line of defence |
| `CHECK (quantity > 0)` on movements | Direction comes from `type`, never from a sign |
| `ON DELETE RESTRICT` groups → items | Deleting a category must not destroy inventory |
| `ON DELETE CASCADE` items → movements | No ledger rows pointing at a deleted item |

`synchronize` is **false everywhere**: the schema only ever changes through a reviewed migration.

```bash
npm run migration:run      # apply
npm run migration:revert   # roll back
npm run seed               # demo data (idempotent)
```

**The seed is deterministic and self-consistent.** Items are created empty and their stock is built by applying the movements, so the ledger explains the stock by construction. 3 groups, 10 items, 20 movements — including items below their minimum and one at zero, so the low-stock filter has something to show.

---

## Environments

Two independent environments, plus local development, all from **one `docker-compose.yml`**. What separates them is the env file: it sets the compose project name (so Docker treats each as its own stack with its own containers, network and volume), the ports, and the database credentials.

| | Local | **Test** | **Production** |
|---|---|---|---|
| API | :3000 | **:3100** | **:3200** |
| PostgreSQL | :5432 | :5433 | :5434 |
| Env file | `.env` | `.env.test` | `.env.production` |
| Database | `inventory_dev` | `inventory_test` | `inventory_prod` |
| Credentials | dev defaults | own | own |
| Demo data | yes | yes | **never** |

```bash
cp .env.test.example .env.test              # set a real password
cp .env.production.example .env.production

npm run docker:dev     # :3000
npm run docker:test    # :3100
npm run docker:prod    # :3200
```

All three can run at once without colliding. Production starts with an empty inventory: `SEED=false`, and the application refuses to seed when `NODE_ENV=production` even if it were set.

---

## Testing and coverage

105 tests against **real PostgreSQL** — the suite asserts on transactions, row locks and CHECK constraints, none of which can be faked.

```bash
npm run db:up      # start PostgreSQL
npm test           # run the suite
npm run report     # suite + coverage against both gates
```

| File | Covers |
|---|---|
| `test/groups.spec.ts` | Group CRUD, PUT vs PATCH, uniqueness, delete rules |
| `test/items.spec.ts` | Item CRUD, filters, **the QUERY endpoint** |
| `test/movements.spec.ts` | IN, OUT, insufficient stock, **concurrency**, the CHECK constraint |
| `test/error-handling.spec.ts` | Error shape, database error mapping, no leaks in production |
| `test/app.spec.ts` | Health check, Swagger, seed consistency |

### Coverage

| Metric | Achieved | Test gate | Production gate |
|---|---|---|---|
| Statements | **98.4%** | 60% | 85% |
| Lines | **98.4%** | 60% | 85% |
| Functions | **97.6%** | 60% | 85% |
| Branches | **93.0%** | 60% | 85% |

The gate is Jest itself:

```ts
// jest.config.ts
const COVERAGE_MIN = Number(process.env.COVERAGE_MIN ?? 85);
coverageThreshold: { global: { lines: COVERAGE_MIN, /* ... */ } }
```

Jest exits non-zero when a test fails **or** coverage falls short. That non-zero exit is what stops the pipeline. There is no `|| true` and no ignored exit code anywhere.

---

## CI/CD

Two GitHub Actions pipelines, one job each, steps in order. A step that fails ends the job, so the deploy step is simply never reached.

```
Test Pipeline (develop)        Production Pipeline (main)
  install                        install
  lint                           lint
  build                          build
  test + coverage >= 60%   ←→    test + coverage >= 85%
  docker build                   docker build
  deploy to Test                 deploy to Production
```

Both run the suite against a real PostgreSQL service container. `COVERAGE_MIN` is the only difference in the gate: `60` in one file, `85` in the other.

---

## Git workflow

Two fixed branches: **`main`** is production and stays stable, **`develop`** is where work happens. Work is merged into `main` at milestones, once the Test pipeline is green.

Commits use [GitMoji](https://gitmoji.dev/) and are written in English:

```
✨ feat: implement the Group module
🐛 fix: order low-stock items by a select alias
✅ test: cover the inventory rule under concurrency
🐳 chore: add the Dockerfile and compose stack
🚀 ci: add the Test pipeline with a 60% coverage gate
♻️ refactor: drop the repository layer
```

No `.env` file, password or key is ever committed — `.gitignore` allows only the `*.example` templates.
