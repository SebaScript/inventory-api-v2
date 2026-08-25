# Postman collection

A runnable tour of every endpoint, including the HTTP QUERY verb.

## Import

In Postman, **Import** and drop in these four files:

| File | What it is |
|---|---|
| `inventory-api.postman_collection.json` | The collection: 38 requests in 7 folders |
| `local.postman_environment.json` | Local development — `http://localhost:3000` |
| `test.postman_environment.json` | Test environment — `http://localhost:3100` |
| `production.postman_environment.json` | Production environment — `http://localhost:3200` |

Pick an environment in the top-right selector before sending anything: every
request builds its URL from `{{baseUrl}}`.

## Run the whole thing

The folders run in order and each one leaves behind the ids the next one needs,
so **Run collection** exercises the API end to end. Every request carries tests,
and a full run should finish with no failures.

| Folder | What it shows |
|---|---|
| 1. Health | The service and its database are reachable |
| 2. Groups | CRUD, and the difference between PUT (replaces) and PATCH (merges) |
| 3. Items | CRUD, filters, and **the QUERY verb** with its POST alias |
| 4. Movements | IN and OUT, the transaction, the ledger |
| 5. Business rules | Requests that fail **on purpose** — this is where the domain rules show |
| 6. Discontinue | DELETE withdraws a product without erasing its history |
| 7. Documentation | The generated OpenAPI document |

Folder 5 is the interesting one: insufficient stock, duplicate SKU, a category
that still holds products, a client trying to set the stock directly. Each
returns the error the API is designed to return, so a green run means the rules
held.

## The QUERY request

`QUERY /items/search` uses a real HTTP method, not a workaround. If your
Postman build cannot send it, the folder also contains `POST /items/search`,
which takes the same body and returns the same response.

## Notes

- Numeric variables are written unquoted in the bodies — `"groupId": {{groupId}}`.
  Quoting them would send the id as a string and the API would answer `400`.
- A full run leaves one demo category and one demo product behind. Names carry a
  timestamp, so repeated runs never collide.
- Switching environment and running again is the quickest way to show that Test
  and Production are genuinely separate: the same requests, different data.
