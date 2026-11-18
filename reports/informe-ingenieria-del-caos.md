# Informe de experimento: Ingeniería del Caos

**Proyecto:** API A (inventario, AWS) + API B (órdenes, Google Cloud) · **Versiones:** (a) y (c):
ronda 0 en `v4.1.0`, ronda 1 en `v4.2.0`; (b): API B `chaos-round-0` y `chaos-round-1` ·
**Fecha de ejecución:** 15-nov-2026 (a, c) y 16-nov-2026 (b), hora Colombia · **Instrumento:** k6
(`chaos/load.js`) ·
**Herramienta declarativa:** Chaos Toolkit (`chaos/experiments/`)

## 1. Sistema y estado estable

El flujo es síncrono: `GET /v2/items/:id` en API A (k3s en EC2, 2 réplicas) lee el item en RDS y,
en la misma petición, pide un registro a API B (`/interop/orders/random`), propagando
`x-correlation-id` y `traceparent`. API A devuelve siempre el item; el campo `partner.status`
dice si llegó el registro de B (`ok`) o no (`unavailable`).

**Perfil de carga fijo** (`chaos/slo.json`), idéntico en todas las runs: 30 s de rampa hasta
20 peticiones/s, 150 s de meseta y 15 s de bajada (unas 3 450 peticiones); la mitad son el flujo y
la otra mitad lecturas simples (`GET /items/:id`, que no llaman a B).

**Estado estable medido** con tres runs sin fallo (workflow `Chaos`, `experiment=steady`):

| run | p95 del flujo | p95 de lectura | `partner ok` | Peticiones fallidas |
|---|---|---|---|---|
| s1 (run 43780002984) | 126 ms | 72 ms | 100 % | 0 % |
| s2 (run 43788999130) | 71 ms | 22 ms | 100 % | 0 % |
| s3 (run 43789365841) | 60 ms | 9 ms | 100 % | 0 % |

Los umbrales de las hipótesis quedan por encima del peor valor medido y por debajo de lo que un
usuario percibe como lento: 500 ms para el flujo, 300 ms para las lecturas y 99 % de `partner ok`.

**Traza que cruza las dos nubes:** traceId `34df0716fbcea70db4f606f7d2fc4b3b` (Grafana Cloud →
Explore → Tempo): 2 servicios y 24 tramos, 17 de `inventory-api` (AWS, us-east-1) y 7 de
`orders-api` (Cloud Run, us-central1), entre ellos sus 2 consultas a PostgreSQL. El tramo de
entrada de B (13 ms) cae dentro del tramo HTTP cliente de A (51 ms). Su padre directo es un tramo
intermedio que no llega a Tempo (probablemente el frontal de Cloud Run): Tempo muestra las dos
partes en la misma traza, pero no las une con una flecha de padre a hijo.

## 2. Experimentos

| | (a) Latencia hacia API B | (c) Pool de conexiones agotado | (b) BD de API B inalcanzable |
|---|---|---|---|
| Dueño | API A | API A | API B |
| Hipótesis | Con +2 s hacia B durante 5 min, el p95 del flujo sigue < 500 ms | Con 6 reportes lentos/s durante 4 min, el p95 de las lecturas sigue < 300 ms | Con la BD de B caída 4 min, ≥ 99 % del flujo trae `partner ok` |
| Inyección | Documento de AWS `AWSFIS-Run-Network-Latency-Sources` por Systems Manager (`tc` en el nodo) | Interruptor propio: `x-fault: slow-db` + `x-fault-token`; cada reporte retiene su conexión 2 s | Interruptor propio de B: `FAULT_DB` |
| Radio de impacto | Un nodo y un solo destino (el host de B) | Solo las peticiones con el token; el pool de la API (5 por réplica) | La revisión de B y sus consultas |
| Aborto | Alarma `inventory-api-flow-errors` (5xx > 5 %) vía *safeguard*; k6 aborta con > 50 % de fallos | k6 aborta con > 50 % de fallos | k6 aborta con > 50 % de fallos |
| Reversión | Cancelar el comando y borrar la qdisc de `tc` (medido: 6 s) | Cortar el flujo de reportes | Quitar `FAULT_DB` |

Chaos Toolkit mide el estado estable, inyecta, **vuelve a medir con el fallo activo** (ventana de
195 s) y ejecuta siempre la reversión. Si la segunda medida incumple el umbral, el experimento
queda *deviated*: hipótesis refutada.

## 3. Ronda 0: sistema sin proteger

| Experimento | Run | Antes del fallo | Con el fallo | Resultado |
|---|---|---|---|---|
| (a) | 43789807913 | p95 flujo 75 ms · `partner ok` 100 % | **p95 flujo 1 529 ms** · `partner ok` 0 % | Refutada |
| (c) | 43786362575 | p95 lectura 74 ms · fallos 0 % | **p95 lectura 10 062 ms** · fallos 13,2 % · `partner ok` 86,9 % | Refutada |
| (b) | API B, `evidence/round-0/journal.json` | Estado estable superado | **`partner ok` 0,0 %** · p95 flujo 88 ms · fallos 0 % | Refutada |

**Diagnóstico (mecanismo, no síntoma).**

- **(a) Saturación por un timeout demasiado largo.** El cliente de API A esperaba a B hasta 1,5 s.
  Con 2 s de latencia, cada petición del flujo consumía el timeout completo antes de degradar: el
  p95 (1 529 ms) es el propio timeout más el viaje. Cada petición de k6 lleva
  `x-correlation-id: k6-a-partner-latency-r0-<n>`: con ese id, los logs de `/inventory-api/app`
  muestran `Partner lookup failed: The operation was aborted due to timeout` y su `traceId`, y la
  traza en Tempo muestra el tramo HTTP hacia B ocupando la petición (p. ej. la petición
  `k6-a-partner-latency-r0-2000`: 1 505 ms, traceId `ae847602573109e175762f197101c0a6`, en Grafana
  Cloud → Explore → Tempo).
  Las lecturas simples no se inmutan (29 ms): el fallo es de la dependencia, no del proceso.
- **(c) Agotamiento del pool de conexiones, con efecto en cascada.** 6 reportes/s × 2 s ≈ 12
  conexiones ocupadas frente a 10 disponibles (5 por réplica × 2). Las lecturas, que no tienen nada
  que ver con los reportes, hacen cola esperando una conexión sin límite de tiempo; su p95 sube a
  10 s y el 13,2 % falla. El fallo de un endpoint secundario tumba a toda la API, incluido el flujo
  con B.
- **(b) Dependencia sin respaldo.** Con `FAULT_DB=unreachable`, cada consulta de API B se cuelga
  10 s y falla, y B no tiene ningún dato con el que responder: se pierde el 100 % del registro de B.
  API A ya estaba en `v4.3.2`, con el timeout y el circuit breaker de (a), y por eso no se cayó con
  B (p95 88 ms, 0 % de fallos). Su métrica `PartnerCalls` lo muestra minuto a minuto
  (16:59–17:03 hora Colombia): `ok` cae a 0, salen 10 `unavailable` en el primer minuto (los 5
  fallos seguidos por réplica que abren el circuito) y después ~596 `short-circuited` y exactamente
  4 `unavailable` por minuto: la llamada de prueba cada 30 s de cada una de las 2 réplicas.

## 4. Mejoras aplicadas (API A en v4.2.0; API B en `chaos-round-1`)

| Fallo | Patrón | Por qué ese patrón, a partir del diagnóstico |
|---|---|---|
| (a) | **Timeout por dependencia de 300 ms** | Por encima de lo que tarda B en estado estable (~100 ms) y por debajo del objetivo de 500 ms: falla rápido en vez de agotar el presupuesto de latencia |
| (a) | **Circuit breaker** (5 fallos seguidos → abierto 30 s → una llamada de prueba) | Con B degradado, ni siquiera se espera el timeout: se responde degradado al instante y se deja de cargar a B |
| (c) | **Bulkhead**: 2 reportes a la vez por réplica; el resto, 503 inmediato | Garantiza que al menos 3 de las 5 conexiones queden para las lecturas |
| (c) | **`statement_timeout` de 1 s** en el reporte (`SET LOCAL`) y espera máxima de 2 s por conexión | Ningún reporte retiene una conexión indefinidamente; ninguna petición espera para siempre |
| (b) | **Presupuesto de 150 ms** para las consultas de `/interop/orders/random` (API B) | Menor que el timeout de 300 ms de A: a B le da tiempo de responder con su respaldo antes de que A corte |
| (b) | **Caché de respaldo** con las últimas 50 órdenes buenas, precalentada al arrancar; responde 200 con `attributes.stale = true` y la misma forma del contrato (API B) | Ataca el mecanismo de la ronda 0: B no tenía ningún dato con el que responder |

Se descartaron los **reintentos con backoff** para la llamada a B: con B lento, reintentar
multiplica su carga (tormenta de reintentos) y alarga la espera. Todos los patrones tienen tests
(102 en verde).

## 5. Ronda 1: mismo perfil, mismo fallo, misma duración, mismo instrumento

| Experimento | Run | Métrica objetivo | Ronda 0 | Ronda 1 | Variación | Hipótesis |
|---|---|---|---|---|---|---|
| (a) | 43791951908 | p95 del flujo | 1 529 ms | **15 ms** | −99,0 % | Se cumple |
| (c) | 43792788322 | p95 de lectura | 10 062 ms | **45 ms** | −99,6 % | Se cumple |
| (b) | API B, `evidence/round-1/journal.json` | % `partner ok` | 0,0 % | **99,9 %** | +99,9 pp | Se cumple |

En (a) el flujo sigue devolviendo el item con `partner.status = unavailable` (degradación
elegante): el usuario pierde el dato de B, no la respuesta. En (c) la tasa de fallos de las
lecturas baja de 13,2 % a 0 % y el flujo mantiene `partner ok` en 100 %; el coste es que los
reportes sobrantes reciben 503 al instante (`EXPORT_BUSY`) o se cancelan a 1 s
(`EXPORT_TIMEOUT`): se sacrifica una función secundaria para proteger la principal.

En (b) B responde desde su caché y A lo recibe como `ok`. La métrica `PartnerCalls` de A, de 21:58
a 22:00 (hora Colombia, con el fallo activo), da 1 660 `ok`, 1 `unavailable` y 0
`short-circuited`; el p95 de la llamada a B (`PartnerCallDuration`) sube de ~58 ms a ~207 ms: los
150 ms del presupuesto más el viaje entre nubes. Quedan unos 90 ms de margen hasta el timeout de
300 ms de A. El p95 del flujo que mide k6 (289 ms, desde fuera de AWS) suma además la red del
cliente y sigue por debajo de 500 ms.

**Chaos gate.** El workflow `Infrastructure` despliega y llama a `Chaos` con el experimento (a):
sobre v4.1.0 el experimento sale *deviated* y el job falla (runs 43780423412 y 43789807913, con el
journal y el resumen de k6 como artifacts); sobre v4.2.0 sale verde (run 43790671859: p95 61 ms con
el fallo activo).

**Tablero.** CloudWatch `inventory-api`: latencia del flujo, ventana del fallo
(`ChaosFaultActive`), llamadas a B por resultado (`ok`, `unavailable`, `short-circuited`),
duración de las llamadas a B, reportes rechazados por el bulkhead y 5xx, todo en el mismo eje de
tiempo. Enlace al tablero con las dos rondas: CloudWatch (us-east-1) → Dashboards → `inventory-api`,
rango 16-nov 01:15–02:45 UTC (15-nov 20:15–21:45 hora Colombia). La ronda 0 de (b) está en el
rango 16-nov 21:55–22:04 UTC (16:55–17:04 hora Colombia): las llamadas a B pasan de `ok` a
`short-circuited`. La ronda 1, en el rango 17-nov 02:52–03:01 UTC (16-nov 21:52–22:01 hora
Colombia): las llamadas siguen `ok` y su duración sube a ~207 ms.

## 6. Hallazgos inesperados

1. **AWS FIS no está disponible en el plan gratuito de la cuenta** (`SubscriptionRequiredException`).
   Se lanza por Systems Manager el mismo documento que FIS ejecuta; Chaos Toolkit aporta el formato
   declarativo y el *safeguard* que sustituye a la condición de parada de FIS.
2. **El fallo no se habría inyectado bien ni con FIS**: la interfaz del nodo no es `ens5`
   (se usa `DEFAULT`) y el documento retrasa por defecto el tráfico de **entrada** (se fijó `egress`).
3. **La reversión tenía una carrera**: limpiar `tc` antes de que terminara la cancelación dejaba el
   retraso unos segundos más. Ahora la reversión espera la cancelación y luego limpia (6 s medidos).
4. **Arranque en frío de API B**: tras un rato sin tráfico, las primeras llamadas superan el
   timeout y salen `unavailable`. Se mitiga con `min-instances=1` en Cloud Run.
5. **En (c) el daño no se quedó en los reportes**: el pool compartido convirtió un fallo de un
   endpoint secundario en una caída parcial de toda la API.
6. **Los patrones de (a) ya contenían (b)**: en la ronda 0 de (b), A siguió respondiendo en 88 ms
   sin un solo fallo. Lo que se perdió fue el dato de B, y eso solo lo podía arreglar B.

## 7. Backlog de resiliencia

- El circuit breaker vive en memoria de cada réplica: dos réplicas abren su circuito por separado.
- Los reportes deberían ser asíncronos (cola + aviso al terminar) en vez de rechazarse con 503.
- Un solo nodo: un fallo del nodo es un fallo correlacionado de las dos réplicas. Siguiente
  experimento: terminar el nodo y medir el MTTR.
- Ajustar el timeout de 300 ms al p99 real de B medido durante más tiempo.
- La caché del registro de B (Redis) existe en el código pero no está desplegada.
- API B: una instancia que arranque con la base ya caída no puede precalentar su caché y
  respondería 503 (no probado).
- Con el fallo (b) activo, la llamada a B tiene ~90 ms de margen frente al timeout de 300 ms: si
  se baja ese timeout, hay que volver a medir (b) antes.

## 8. Uso de IA en el análisis

Se usó **Claude Code** (Anthropic) durante todo el ejercicio.

| Propuso | Se aplicó | Se descartó, y por qué |
|---|---|---|
| Timeout + circuit breaker para (a), bulkhead + timeout de consulta para (c) | Sí | — |
| Reintentos con backoff y jitter | — | Con B lento provocarían una tormenta de reintentos |
| AWS FIS para el fallo (a) | Parcialmente | El plan gratuito lo bloquea; se usa su documento por SSM |
| Chaos Mesh en el clúster | — | Más piezas en un nodo pequeño para lo mismo que hace `tc` |
| Diagnóstico de la interfaz `ens5`, del tráfico de entrada y de la carrera en la reversión | Sí | — |

Cada propuesta se contrastó con una medición real (k6, journal de Chaos Toolkit, estado de `tc` en
el nodo); ninguna se aceptó sin esa prueba.
