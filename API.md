# API SCCVI y permisos

Todas las rutas de negocio se publican bajo `/api/v1` y responden `{ valid, data, msg }`. Las colecciones devuelven sus elementos en `data` y la paginación estable en `meta` (`current_page`, `per_page`, `total`, `last_page`). Las validaciones responden 422 y las actualizaciones `PATCH` requieren `version`; una edición concurrente responde 409.

`GET /api/v1/health` es público para el healthcheck de contenedor y devuelve el mismo envelope.

| Área | Rutas | Acceso |
|---|---|---|
| Sesión y personas | `GET /sesion`, `GET /personas/buscar` | sesión SSO; buscar requiere clínico/admin |
| Lecturas y búsqueda | `GET /lecturas/menores`, `GET /busquedas/menores?q=`, `POST /lecturas/reconstruir` | Mongo para lectura y Elasticsearch por tokens normalizados; reconstrucción sólo admin |
| Menores | `GET/POST /menores`, `GET/PATCH /menores/:id` | lectura ciudadana sólo con relación activa; altas/edición clínico/admin |
| Alta familiar | `POST /familias` | clínico/admin; crea o reutiliza identidades en SSO y sólo crea en SCCVI el expediente y los vínculos |
| Responsables | `GET/POST /menores/:id/responsables`, `PATCH/DELETE /menores/:id/responsables/:relacionId` | lectura relacionada; mutación clínico/admin; PATCH y DELETE requieren `version` |
| Catálogos | `GET/POST/PATCH /vacunas`, `GET/POST/PATCH /esquemas`, `POST /esquemas/:id/dosis` | lectura autenticada; mutación admin |
| Clínica | `GET/POST /menores/:id/vacunacion`, `GET/POST /menores/:id/mediciones`, `GET /menores/:id/alertas`, `POST /alertas/recalcular` | lectura relacionada; mutación clínico/admin |
| Jornadas y reportes | `GET/POST/PATCH /jornadas`, `GET /reportes/cobertura`, `GET /reportes/pendientes` | lectura de jornada autenticada; mutación/reportes admin |

`GET /busquedas/menores` admite `q`, `cui` (uno a trece dígitos para búsqueda progresiva), `fecha_nacimiento`, `vacuna_codigo`, `estado_vacuna`, `alerta_tipo`, `ultima_vacuna_desde`, `ultima_vacuna_hasta`, `page` y `per_page`. El backend combina estos filtros y aplica siempre el territorio autorizado; no se debe filtrar la colección en el navegador.

| Carné verificable | `POST/DELETE /menores/:id/carne-publico[/token]`, `GET /public/carnes/:token`, `POST /public/carnes/:token/consultar` | generar/revocar requiere acceso al menor; el GET sólo confirma vigencia y el POST exige PIN; ambas rutas públicas limitan a 10 intentos/minuto por IP y token (`429 RATE_LIMITED`); después del PIN devuelve nombre, vacunas y último control, nunca CUI, dirección, responsables, contactos ni notas |

`sccvi.clinical`, `sccvi.admin` y `sso.admin` se resuelven exclusivamente desde el JWT o la sesión validada por SSO. Un ciudadano sin relación recibe 404 para no revelar datos clínicos.

## Integraciones

- SSO: JWKS para Bearer y `auth/session/me` para la sesión portal HTTP-only. `POST /familias` crea/reutiliza personas y reenvía los contactos anidados de cada responsable a `POST /personas/:id/contactos`; SCCVI nunca persiste destinos. Si un timeout ocurre después de crear un contacto, compara canal/destino normalizado en SSO antes de reintentar. Las alertas resuelven fecha de nacimiento; la outbox sólo consulta contactos justo antes del envío.
- Geo: el backend verifica departamento, municipio y comunidad; la SPA carga los catálogos públicos sin replicarlos y permite municipio urbano sin comunidad.
- Notificaciones: `sccvi_outbox_notificaciones` conserva finalidad, variables permitidas e idempotencia. SCCVI envía sólo `persona_id`; Notificaciones resuelve contactos vigentes en SSO y no se guardan ni reciben destinos libres en SCCVI.

Las respuestas inválidas de SSO/Geo se convierten en 502 y sus indisponibilidades o timeouts en 503. La indisponibilidad de Notificaciones deja el evento en la outbox para reintento; no modifica la aplicación clínica original.
## Crecimiento OMS

`POST /menores/:id/mediciones` requiere `fecha`, `peso_kg`, `talla_cm` y `tipo_medicion` (`LONGITUD` o `TALLA`). Puede incluir `sexo_curva_evaluacion` únicamente si la identidad SSO no es femenina o masculina y existe documentación clínica para elegir una curva. La respuesta entrega edad exacta en días, talla corregida cuando corresponde, puntuaciones Z, percentil (sólo dentro de ±3 Z), clasificación y la versión/hash del estándar usado. La corrección nunca altera la fila anterior: `POST /menores/:id/mediciones/:medicionId/correccion` crea una nueva medición vigente, referencia la reemplazada y exige `motivo_correccion`.

Los datos LMS provienen de OMS y se cargan con `npm run seed:growth-standards`; su procedencia y hashes están en `src/data/who/PROVENANCE.md`. Las alertas `P<5` y `P>95` se crean por indicador, quedan auditadas y se encolan idempotentemente por `persona_id` del responsable, sin copiar contactos. La misma recalculación crea o resuelve `CONTROL_AUSENTE`: control mensual desde 0 hasta menos de 2 años y trimestral desde 2 hasta 5 años; el mensaje ciudadano sólo recomienda acudir al centro de salud y no emite un diagnóstico.

`GET /reportes/crecimiento` agrega evaluaciones, alertas P5/P95 y promedios Z dentro del territorio autorizado. `GET /reportes/exportar?formato=xlsx|pdf` descarga el mismo conjunto territorial en XLSX o PDF; es una descarga binaria deliberadamente no envuelta y requiere el mismo acceso de lectura clínica.
