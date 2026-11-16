# Informe del game day: Caos de Seguridad (Defensa en Profundidad)

**Proyecto:** API A (inventario, AWS) + API B (órdenes, Google Cloud) · **Versiones:** ronda 0
sobre `v4.2.0` (controles como estaban), ronda 1 sobre `v4.3.0` (controles mejorados) ·
**Alcance (versión de 2):** Exp 1 (identidad de máquina, A), Exp 4 mínimo (resiliencia de datos,
A ejecuta y B analiza) y Exp 3 (telemetría e IA, B) · **Reglas de compromiso:**
`security/RULES-OF-ENGAGEMENT.md`

> Las celdas marcadas **(ronda pendiente)** se rellenan con el sello de tiempo real de cada
> corrida de `gameday.yml`; la estructura, las hipótesis y los mecanismos ya están fijados.

## 1. Inventario de controles y estado estable de seguridad

El game day se corre sobre la misma arquitectura del caos de DevOps: API A es k3s en una EC2
detrás de un ALB, con RDS y un bucket S3; el flujo `GET /v2/items/:id` llama a API B. Aquí la
métrica no es la latencia sino la **eficacia de los controles**: ¿detectan?, ¿contienen?

| Capa | Control (4.2.0) | Dueño | Señal esperada | MTTD/MTTC base |
|---|---|---|---|---|
| Identidad | Rol del nodo sin claves estáticas, IMDSv2 (hop limit 2) | A | — | Sin detección de uso indebido: ∞ / ∞ |
| Red | SG: nodo solo desde el ALB; RDS solo desde el nodo | A | — | — |
| Carga | Pods no root, disco de solo lectura, sin capacidades | A | — | — |
| Datos | S3 privado y cifrado (AES-256); RDS cifrada | A | — | Sin versionado: RPO/RTO = ∞ |
| Detección | CloudWatch Logs y alarmas (plano de control) | A | Alarma | Sin CloudTrail de datos: 0 % de cobertura a nivel de objeto |
| Telemetría e IA (GCP) | Alertas de Cloud Monitoring, asistente Gemini | B | Alerta | 🅱️ |

**Cobertura de telemetría medida antes de tocar nada (ronda 0):** a nivel de objeto en S3, el
plano de datos **no se registra** (no hay CloudTrail con *data events*), así que las técnicas de
los experimentos 1 y 4 no dejan rastro consultable. Esa es la línea base: sin ella no hay
experimento, y es justo lo que la ronda 0 confirma.

## 2. Hipótesis de control (falsables)

- **Exp 1.** Dado el rol del nodo tal como está hoy, cuando sus credenciales se usen desde fuera
  de la VPC, esperamos la señal en `/security/alerts` en **≤ 5 min (T1)** y la contención
  (credencial inservible) en **≤ 10 min (T2)**.
- **Exp 4.** Dado el bucket tal como está hoy, cuando los objetos `flows/` se sobrescriban o
  borren, esperamos que la última versión buena sea **recuperable**, con un RTO medido y un RPO
  igual al tiempo desde la última escritura buena.

La ronda 0 está pensada para **refutar** ambas: sin CloudTrail no hay señal (MTTD = ∞) y sin
versionado no hay recuperación (RPO/RTO = ∞).

## 3. Experimento 1 — Identidad de máquina (A)

**Escenario.** Un atacante con ejecución en un pod (hop limit 2) lee las credenciales temporales
del rol del nodo en IMDSv2 y las usa **desde fuera de AWS** (el runner de GitHub) contra S3.
**ATT&CK:** T1552.005 (credenciales vía metadatos de la nube), T1078.004 (cuentas de nube
válidas), T1530 (datos de almacenamiento en la nube).

**Cómo se ejecuta (como código).** `gameday.yml step=exp1-attack`: por SSM lee IMDSv2 en el
nodo, extrae las credenciales y, ya en el runner, hace `GetObject` sobre un objeto `flows/` y
sobre el honeytoken. Marcado con `AWS_EXECUTION_ENV=gameday-exp1-r<ronda>` (queda en el
`userAgent` de CloudTrail). Parada: cancelar el run.

### Cronología

| Momento | Ronda 0 (v4.2.0) | Ronda 1 (v4.3.0) |
|---|---|---|
| T0 — credencial robada y usada | GetObject **tiene éxito**: la credencial sirve fuera de AWS | GetObject sobre `flows/` → **AccessDenied** (bucket policy `aws:SourceVpce`) |
| Detección (MTTD) | ∞ — nada lo registra a nivel de objeto | (ronda pendiente) — alerta en `/security/alerts` por la regla `node-role-outside-vpce` |
| Lectura del honeytoken | se lee sin alerta | alerta por la regla `honeytoken-read` |
| Contención (MTTC) | ∞ — la credencial sirve hasta caducar | (ronda pendiente) — `exp1-contain` revoca las sesiones |

**Mejoras aplicadas (v4.3.0), dos propias de la capa:**

1. **Detección (D3-RAPA Resource Access Pattern Analysis).** CloudTrail con *data events* de S3 →
   regla EventBridge: el rol del nodo tocando S3 **sin `vpcEndpointId`** → `/security/alerts` +
   alarma. Probada como código: evento positivo dispara, evento negativo (a través del endpoint)
   no. Verificado con `aws events test-event-pattern` (`ok` en los dos casos).
2. **Frontera de red (D3-NI Network Isolation).** Endpoint de VPC para S3 + *bucket policy* que
   **niega el acceso a `flows/` del rol del nodo que no llegue por el endpoint** (`aws:SourceVpce`).
   La credencial robada, usada fuera, recibe `AccessDenied`. Se acota al rol y al prefijo `flows/`
   para no romper ni Terraform ni los enlaces prefirmados de `exports/`.
3. **Contención (D3-CR Credential Revoking).** `exp1-contain` aplica la política *revoke older
   sessions* (deny con `aws:TokenIssueTime` < ahora) al rol: las sesiones emitidas antes dejan de
   servir; el nodo recibe credenciales nuevas y sigue sirviendo. Se revierte sola (sin drift).

**ISO 27001:2022 Anexo A:** A.5.17, A.8.2, A.8.15, A.8.16, A.8.22. **Zero Trust (NIST SP
800-207):** la credencial por sí sola ya no basta; se verifica también el contexto (origen).

## 4. Experimento 4 — Resiliencia de los datos (A ejecuta, B analiza)

**Escenario.** Ransomware: sobrescribir con cifrado y borrar los objetos `flows/` de un único
bucket, con datos sintéticos. **ATT&CK:** T1486 (datos cifrados para impacto), T1485
(destrucción de datos).

**Cómo se ejecuta.** `gameday.yml step=exp4-attack` escribe un objeto bueno, lo sobrescribe con
basura e intenta borrarlo; `step=exp4-restore` recupera la última versión buena y mide el RTO.

### Cronología y medición

| Métrica | Ronda 0 (v4.2.0) | Ronda 1 (v4.3.0) |
|---|---|---|
| Versiones conservadas tras el ataque | 1 (sin versionado): nada que recuperar | ≥ 2: la versión previa sobrevive |
| Borrado del objeto | elimina el dato | crea un *delete marker*; la versión queda |
| RPO | ∞ | (ronda pendiente) — tiempo desde la última escritura buena |
| RTO | ∞ | (ronda pendiente) — lo mide `exp4-restore` |

**Mejoras aplicadas (v4.3.0):**

1. **Versionado + Object Lock (governance, 1 día).** WORM: la versión buena no se puede borrar ni
   sobrescribir dentro de la retención. *Governance* y no *compliance* para permitir el `destroy`
   del final (contrapartida asumida). La bitácora de CloudTrail va a un bucket **versionado**
   aparte (bitácora inmutable: el atacante no borra su rastro).
2. **Regla de borrado (`flows-destruction`).** EventBridge sobre `DeleteObject` en `flows/` →
   `/security/alerts`. Probada como código (positivo dispara, negativo —una lectura— no).

**ISO 27001:2022 Anexo A:** A.8.13 (copias de seguridad), A.5.30 (preparación de las TIC para la
continuidad).

## 5. Experimento 3 — Telemetría y capa de IA (B)

Lo ejecuta API B; API A debe poder explicarlo en la sustentación. Se degrada la capacidad de ver
(alerta desactivada o exclusión de logs, **T1562.008**) y se inyectan instrucciones escondidas en
un campo de una orden que ingiere el asistente Gemini de triaje (**ATLAS AML.T0051.001**, inyección
indirecta). Mitigación: separar datos e instrucciones, ninguna herramienta con efecto, salida
estructurada y confirmación humana; se repite la prueba. Mejora de telemetría: alerta sobre los
*audit logs* y **alerta por ausencia de señal** (latido). Mapeo: OWASP Top 10 for LLM / Agentic
Applications 2026 (inyección de instrucciones) y MITRE ATLAS. (Resultados y evidencia: informe de
API B.)

## 6. Detección como código

| Regla (`security/detections/`) | Experimento | Positivo | Negativo | Resultado |
|---|---|---|---|---|
| `node-role-outside-vpce` | 1 | rol del nodo sin `vpcEndpointId` | mismo acceso por el endpoint | `ok` / `ok` |
| `honeytoken-read` | tendencia | `GetObject` del honeytoken | `GetObject` de un `flows/` normal | `ok` / `ok` |
| `flows-destruction` | 4 | `DeleteObject` en `flows/` | `GetObject` en `flows/` | `ok` / `ok` |

Cada regla es el **mismo** fichero JSON que Terraform usa para crear la regla EventBridge y que el
workflow `Detections` prueba con `aws events test-event-pattern`. Verificado el 15-nov contra la
API real de AWS: positivo → `True`, negativo → `False` en las tres.

**Cómo se mide.** MTTD = hora de la alerta − hora del primer acto (CloudTrail / log del workflow).
MTTC = hora en que la credencial deja de servir − primer acto. Cobertura = técnicas detectadas /
emuladas. **Falsos positivos:** k6 (`chaos/load.js`) corre en paralelo generando el tráfico normal
del flujo; las reglas no deben dispararse con él (tasa base: si lo malicioso es rarísimo, pocos FP
ahogan a los verdaderos).

## 7. IA en la defensa (humano en el bucle) y tendencias

**IA en la defensa.** Claude Code (API A) y el asistente de B reciben la evidencia del game day
(alertas, CloudTrail, logs) y proponen agrupación, hipótesis de causa y cronología. Se contrasta
con la telemetría real:

| Propuso | Acertó | Inventó / se descartó |
|---|---|---|
| Acotar la *bucket policy* al rol + `flows/` para no romper Terraform ni los prefirmados | Sí (el deny a `*` habría bloqueado el propio `apply`) | — |
| (ronda pendiente: correlación de las alertas de las dos rondas) | | |

**Tendencias verificables, implementadas (no solo mencionadas):**

1. **Honeytoken en el flujo.** Objeto señuelo `flows/admin-credentials-backup.json` + regla
   EventBridge sobre su `GetObject`. D3FEND **D3-DO (Decoy Object)**. Fuente de la tendencia de
   engaño/ITDR: (citar con fecha de consulta en el README). Nadie legítimo lo lee → alerta casi
   sin FP.
2. **Identidad de máquina no gestionada / Cyber Resilience Act (B).** El reporte del incidente
   simulado se estructura con los tiempos del Reglamento (UE) 2024/2847 (aviso 24 h, notificación
   72 h), contrastado con lo exigido en Colombia. (Fuente y fecha en el README.)

## 8. Riesgos residuales y próximos experimentos

- El pipeline usa **claves estáticas de AWS** en secretos de GitHub; lo correcto sería federación
  OIDC (identidad sin secretos). Riesgo residual asumido.
- Object Lock en *governance*: un administrador con `s3:BypassGovernanceRetention` puede borrar.
  Permite el `destroy`; en real sería *compliance* + copia aislada.
- El honeytoken y la regla `node-role-outside-vpce` cubren el uso **externo**; un atacante que
  opere **desde dentro del nodo** (por el endpoint) no dispara la regla de origen — ahí actúa el
  honeytoken y el patrón de acceso (D3-RAPA tiene esa limitación, documentada por MITRE).
- Enlaces prefirmados de `flows/`: con la *bucket policy* se descargarían fuera de la VPC con
  `AccessDenied`. Es aceptable (los `flows/` son internos); los `exports/` siguen abiertos.
- Próximo experimento: terminar el nodo (fallo correlacionado de las dos réplicas) y medir el MTTR;
  y el experimento 2 (exposición/segmentación), fuera del alcance de la versión de 2.

## 9. Uso de IA en el análisis

Se usó **Claude Code** (Anthropic). Cada propuesta se contrastó con una comprobación real: las
reglas se validaron con `aws events test-event-pattern` antes de commitearlas, los IDs de MITRE
ATT&CK, D3FEND y ATLAS se verificaron en los sitios oficiales, y Terraform se validó con
`terraform validate`. Ninguna afirmación medida se dio por buena sin su evidencia.
