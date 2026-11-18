# Operación y despliegue de SCCVI

SCCVI mantiene solamente datos clínicos y relaciones. SSO sigue siendo la fuente de personas, CUI, roles y contactos; Geo, de departamentos, municipios, comunidades y direcciones; Notificaciones, de la entrega por canal.

## Configuración necesaria

Defina fuera del repositorio `DB_PASSWORD`, `SSO_SERVICE_TOKEN` y `SSO_SYSTEM_TAG=sccvi`. `SSO_SERVICE_TOKEN` debe tener el permiso administrativo de SSO necesario para resolver personas y contactos; nunca se envía al navegador. Configure también `SSO_JWKS_URI`, `SSO_BASE_URL`, `GEO_BASE_URL`, `NOTIFICATIONS_BASE_URL` y `CORS_ORIGINS`.

Las rutas públicas de carné usan Redis compartido (`PUBLIC_CARD_RATE_LIMIT_REDIS_URL`) para limitar atómicamente tanto IP (30/minuto) como combinación IP/token (10/minuto), antes de Argon2. Las claves guardan sólo SHA-256 de esos valores, tienen TTL y Redis falla cerrado: no existe una degradación silenciosa a un `Map` por proceso.

La API acepta un Bearer JWT de SSO validado por JWKS. Para el portal SSO existente, SCCVI reenvía la cookie HTTP-only al endpoint `auth/session/me` con el encabezado `System`; no extrae ni almacena el JWT en la SPA. Los roles/permiso configurados en SSO deben incluir exactamente `sccvi.admin` o `sccvi.clinical` (o `sso.admin`).

## Instalación aislada

```powershell
Copy-Item .env.example .env
npm install
npm run build
$env:DB_DATABASE='sccvi-test'
npm run db:init
npm run migration:run
npm run seed:growth-standards
npm run seed:demo
npm test
```

El seed OMS es idempotente y carga 13,546 parámetros LMS oficiales para el estándar `WHO-CGS-2006-0-5`; ver `src/data/who/PROVENANCE.md`. El seed de vacunación es idempotente pero **DEMO**: carga 15 vacunas y 30 dosis en `PAI-GT-DEMO-2026`, sin afirmar aprobación clínica ni sustituir un PAI vigente. Las personas ficticias viven en SSO (`MspasVerapacesDemoSeeder`, ≥50 menores+responsables por departamento; `SSO_SEED_CHILDREN_PER_DEPARTMENT`). Después, `npm run seed:demo` en SCCVI resuelve esos CUIs vía directorio SSO, consulta Geo y materializa **al menos 50 expedientes clínicos por departamento** (`SCCVI_SEED_CHILDREN_PER_DEPARTMENT`), cada uno con su responsable, mediciones y aplicaciones ficticias. No persiste destinos de contacto. No ejecute `sccvi-test`, migraciones ni seeders contra una base productiva sin un procedimiento de cambio autorizado.

Para una verificación repetible con los servicios de desarrollo ya definidos en `C:\laragon\www\.env.infrastructure`, use una base distinta y efímera de la aplicación activa:

```powershell
docker compose --env-file C:\laragon\www\.env.infrastructure -f C:\laragon\www\backend-2026-10-sccvi\docker-compose.yml run --rm -e DB_DATABASE=sccvi-test sccvi sh -lc "npm run db:init && npm run migration:run && npm run seed:growth-standards && npm run seed:demo"
docker compose --env-file C:\laragon\www\.env.infrastructure -f C:\laragon\www\backend-2026-10-sccvi\docker-compose.yml run --rm -e DB_DATABASE=sccvi-test sccvi sh -lc "npm run migration:run && npm run seed:growth-standards && npm run seed:demo"
```

La segunda ejecución debe informar que no hay migraciones pendientes y conservar los mismos totales del seed. No ejecute estos comandos contra `sccvi-db` ni contra una base de producción.

## Variables

`PORT`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `SSO_JWKS_URI`, `SSO_BASE_URL`, `SSO_SYSTEM_TAG`, `SSO_TIMEOUT_MS`, `SSO_SERVICE_TOKEN`, `SSO_SERVICE_USERNAME`, `SSO_SERVICE_PASSWORD`, `GEO_BASE_URL`, `GEO_TIMEOUT_MS`, `NOTIFICATIONS_BASE_URL`, `MONGO_URL`, `MONGO_DATABASE`, `ELASTICSEARCH_NODE`, `RABBITMQ_URL`, `PUBLIC_CARD_RATE_LIMIT_REDIS_URL`, `CORS_ORIGINS` y `OUTBOX_MAX_ATTEMPTS` se documentan con valores no secretos en `.env.example`. Mantenga contraseñas y tokens únicamente en el gestor de secretos o en el entorno de ejecución.

## Comprobación manual

1. Inicie sesión en SSO como clínico, busque una persona de prueba y abra o registre el expediente.
2. Vincule un responsable, seleccione territorio Geo (la comunidad es opcional), registre una dosis y una medición de peso/longitud o talla; pruebe una corrección para confirmar que la medición original queda marcada como corregida y que la nueva la referencia.
3. Abra el carné, genere el QR, compruebe que la lectura pública no contiene identidad y revóquelo; el mismo enlace debe responder 404. En un entorno aislado, repita 11 veces la consulta pública del mismo token desde la misma IP: la última debe devolver `429 RATE_LIMITED` sin revelar si falló el token o el PIN.
4. Compruebe filtros combinados, paginación y un resultado sin coincidencias. Entre como ciudadano y confirme que sólo aparecen sus relaciones activas.
5. Cree una jornada y consulte cobertura/pendientes/crecimiento. Ejecute la recalculación para comprobar la alerta de control ausente (mensual antes de 2 años; trimestral hasta 5). Fuerce una versión antigua en un PATCH para confirmar 409 sin sobrescribir datos.

Límites actuales: Geo, SSO, MongoDB, Elasticsearch, RabbitMQ y Notificaciones son dependencias de ejecución; sus fallos se exponen como estados controlados y deben recuperarse antes de operar búsquedas, proyecciones o entregas. Las operaciones clínicas SQL y la outbox permanecen durables cuando la proyección o la entrega temporalmente no están disponibles.

## Seguridad operacional

Las actualizaciones PATCH y la baja lógica de responsables exigen `version` y ejecutan una condición atómica, por lo que una versión obsoleta responde 409. Alertas se reconstruyen desde fecha de nacimiento que SSO entrega al momento de recalcular; no se persiste esa fecha en SCCVI. La outbox conserva sólo `persona_id`, propósito, variables permitidas e idempotencia. En el despacho SCCVI no consulta ni transmite email, teléfono, WhatsApp o Telegram: Notificaciones resuelve los contactos vigentes en SSO con la credencial de servicio y conserva el destino protegido.
