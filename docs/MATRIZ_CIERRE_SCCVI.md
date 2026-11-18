# Matriz de cierre SCCVI

Actualizada: 2026-11-18. Esta matriz distingue evidencia técnica ejecutada de
la única validación externa pendiente: la aprobación vigente del esquema MSPAS.

| Requisito | Implementación | Prueba | Evidencia / estado |
|---|---|---|---|
| Identidad, CUI y contactos sólo en SSO | SCCVI conserva `persona_id` y relaciones; las altas familiar y desde expediente reenvían contactos a SSO y outbox recibe sólo `persona_id` | `sccvi.service.spec.ts`, `outbox.service.spec.ts`, `clinical-pages.test.tsx` | Sesión HTTP-only real SSO→SCCVI, roles DEMO y pruebas SCCVI/SPA verdes |
| Comunidades sin scraping TSE | Geo usa el catálogo local normalizado/versionado | Geo: lint, test y build | Verificación local verde; no se hizo consulta ni scraping al TSE |
| Familia 1–10 y sin autorrelación | `FamiliaRegistroDto` y validación previa a integración | `sccvi.service.spec.ts` | Verde |
| Contactos por SSO | CRUD SSO; `POST /familias` y `POST /menores/:id/responsables/registrar` reenvían contactos sin persistir destinos, normalizan y reconocen un contacto aceptado antes de un timeout. Ambos formularios usan `@plataforma/forms/ContactListEditor`. | `sccvi.service.spec.ts`, `clinical-pages.test.tsx`, Feature SSO/SQL Server | Contrato, reintento, UI y Feature SSO real verificados; SCCVI no persiste destinos |
| Invitación ciudadana segura | correo SSO verificado, token de verificación de un uso y reset de contraseña; rol queda inactivo hasta ambos pasos | Feature SSO sobre `sso-test` SQL Server | Verificado en las 38 pruebas/202 aserciones SSO; incluye reintento y respuestas no enumerativas |
| Acceso ciudadano aislado | relaciones activas y 404 para menor ajeno | `sccvi.service.spec.ts` | Verde |
| QR + PIN | token opaco, Argon2id, bloqueo, expiración, revocación, copiar enlace, tarjeta imprimible sin PIN y límite Redis distribuido/fail-closed por IP/token antes de Argon2 | `sccvi.service.spec.ts`, `public-card-rate-limit.guard.spec.ts`, `sccvi.controller.e2e-spec.ts`, Playwright | E2E real escritorio/móvil con PIN, ausencia de CUI y revocación; 11ª consulta real respondió 429 |
| OMS 0–5 años | LMS oficial archivado, seed idempotente, sexo/edad exacta, corrección longitud/talla, evaluación reproducible y curvas visibles P3/P5/P50/P85/P95/P97 de peso/edad | `growth-calculator.spec.ts`, `growth.service.spec.ts`, `sccvi.controller.e2e-spec.ts`, build SPA | Verde; fuente/hash en `src/data/who/PROVENANCE.md` |
| Corrección antropométrica | original `CORREGIDA`, nueva fila vigente vinculada y auditoría | `sccvi.service.spec.ts` | Captura/corrección DEMO integrada: 201/201 y estados `CORREGIDA,VIGENTE` |
| P<5 / P>95 sin diagnóstico | alertas clínicas por indicador y mensaje de seguimiento | `growth.service.spec.ts` | Verde |
| Falta de control | 0–<2 mensual; 2–5 trimestral; resolver/reabrir sin re-notificar condición igual | `growth.service.spec.ts` | Verde |
| Vacunación | historial y equivalencias; seed 2026 marcado inequívocamente DEMO | `sccvi.service.spec.ts`; `VACCINATION_CATALOG.md` | Técnica verde; aprobación/fuente MSPAS vigente pendiente externa |
| Jornadas y outbox | audiencia territorial, rango de edad y estado de vacuna; vista previa sin efectos, confirmación explícita, destinatario único e idempotencia `jornada/persona` | `sccvi.service.spec.ts`, `clinical-pages.test.tsx`, `outbox.service.spec.ts` | Verde; RabbitMQ y los consumidores de Notificaciones quedan levantados en el entorno integrado |
| Cobertura territorial | dosis cumplidas / esperadas elegibles, limitado al territorio | `sccvi.service.spec.ts` | Verde |
| Reportes PDF/XLSX | exportador binario, metadatos de solicitante/territorio/estándar OMS, sanitización XLSX y mismas consultas territoriales | `report-export.service.spec.ts`, `report-pagination.spec.ts`, controller E2E | Cobertura, crecimiento y XLSX reales 200; XLSX generado (13,293 bytes); paginación verificada con 201 filas |
| UX móvil y a11y | viewport, tablas semánticas, selector longitud/talla, alta familiar en cuatro pasos con CUI repetido visible, formulario de contactos compartido y confirmación visible antes de campañas | tests SPA, build, Playwright | Typecheck/lint/tests/build SPA verdes; recorridos reales por cuatro roles a 320/390/768/1440 px sin desborde de documento |
| Contrato envelope/BIGINT | filtro global y IDs string en DTO/respuestas | `http/api-envelope.spec.ts`, controller E2E | Verde |
| Migraciones/seed desde cero y repetición | migración OMS correctiva y scripts idempotentes | migración histórica/cero y seed duplicado | Base desde cero e histórica verificadas; seed OMS dos veces; 13,546 parámetros y SHA-256 reproducible |
| Integración SSO/Geo/Notificaciones/Mongo/Elastic | adaptadores, Redis y outboxes durables | pruebas y sondas reales | SSO, Geo, SQL Server, RabbitMQ, Redis, Mongo y Elasticsearch operativos; cola `sccvi.projections.v1` en 0 con consumidor |
| E2E por rol y capturas | arnés Playwright separado y sesiones SSO HTTP-only | Playwright QR y sesiones por rol | 16 recorridos reales de administrador, DDRISS, establecimiento y consulta, y 4 QR, a 320/390/768/1440 px; capturas ficticias en `test-results/` ignorado |

## Comandos ejecutados en este cierre

| Proyecto | Comando | Resultado |
|---|---|---|
| Backend SCCVI | `npm test; npm run typecheck; npm run lint; npm run build; npm run verify:growth-sources` | 13 suites, 93 pruebas, verde; OMS 13,546/13,546 |
| Frontend SCCVI | `npm run typecheck; npm run lint; npm test; npm run build; Playwright por rol y QR` | 6 archivos, 21 pruebas, 16 E2E de roles y 4 E2E QR reales, verde |
| Frontend SSO | `npm run typecheck; npm run lint; npm test; npm run build` | 8 archivos, 26 pruebas, verde |
| Backend SSO | Feature suites sobre `sso-test` SQL Server | 38 pruebas/202 aserciones verificadas; PersonaFeature 11 y seeder DEMO 2 incluidos |
| Geo | `npm run lint; npm test; npm run build` | 2 suites, 4 pruebas, verde; no define script `typecheck` separado |
| Notificaciones | `npm run lint; npm test -- --run; npm run build` | 3 pruebas, verde; no define script `typecheck` separado y el build ejecuta `tsc` por paquete |
| Paquete compartido | `corepack pnpm typecheck; corepack pnpm lint; corepack pnpm test; corepack pnpm build` y `corepack pnpm --filter @plataforma/storybook build-storybook` | 5 archivos, 9 pruebas y Storybook verde; el build informa warnings conocidos de directivas `use client` de dependencias y chunks grandes |

## Único bloqueo externo visible

El catálogo `PAI-GT-DEMO-2026` continúa siendo **DEMO**. Para sustituirlo se
requiere una fuente MSPAS vigente y una aprobación clínica/documental humana;
no se infirió ni inventó un esquema oficial. Los tokens y PIN usados por
Playwright fueron DEMO, efímeros y revocados al finalizar cada ejecución.
