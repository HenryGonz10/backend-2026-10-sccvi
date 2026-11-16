# SCCVI backend

SCCVI administra vacunación infantil en Guatemala. SQL Server conserva únicamente relaciones y datos clínicos SCCVI; SSO sigue siendo fuente de verdad para personas, CUI, roles y contactos; Geo para direcciones/catálogos; Notificaciones para la entrega.

## Arquitectura

`SPA SCCVI → API SCCVI → SQL Server` con JWT verificado por JWKS de SSO. La API no replica personas, contactos ni catálogos Geo. Una alerta genera una fila durable en `sccvi_outbox_notificaciones`; el trabajador entrega a Notificaciones sólo `persona_id`, finalidad y variables permitidas. Notificaciones resuelve los contactos vigentes directamente en SSO. Errores de despacho se reintentan hasta `OUTBOX_MAX_ATTEMPTS` y nunca revierten una aplicación clínica.

Para lecturas rápidas, `SccviReadProjectionService` reconstruye todos los documentos idempotentes en páginas desde SQL Server hacia MongoDB (`sccvi-read.minor_projections`) y mantiene el índice `sccvi-minors-v1` de Elasticsearch. Cada escritura clínica relevante proyecta en segundo plano y el administrador puede solicitar una reconstrucción completa. La proyección protegida conserva sólo los identificadores y datos mínimos que requiere la búsqueda clínica (incluidos CUI/nombre normalizado); no contiene contactos ni credenciales y nunca se expone mediante el carné público. Si Mongo o Elasticsearch no están disponibles, las escrituras clínicas siguen usando SQL Server y la reconstrucción se reintenta.

## Base y datos

Las migraciones crean: menores, responsables, vacunas, esquemas/dosis, jornadas, aplicaciones, mediciones, alertas, outbox de notificaciones, outbox Rabbit de proyecciones y auditoría. `persona_id` y todos los identificadores BIGINT se tratan como cadenas en la API. El carné se construye desde `esquema_dosis` y `registros_vacunacion`; las mediciones quedan en su tabla independiente. El seed idempotente carga el catálogo pediátrico de referencia, cinco menores y encargados ficticios solo después del seed local de SSO.

## Ejecución aislada

```powershell
Copy-Item .env.example .env
# Definir DB_PASSWORD y, para el worker, SSO_SERVICE_TOKEN fuera del repositorio.
npm install
npm run build
$env:DB_DATABASE='sccvi-test'
npm run db:init
npm run migration:run
npm run seed:demo
npm test
```

Para contenedores: `docker compose --env-file ..\.env.infrastructure up --build`. No usar `sccvi-test` ni el seed contra producción.

## Permisos

- `sccvi.admin` o `sso.admin`: catálogos, jornadas, reportes y administración.
- `sccvi.clinical`: menores, responsables, aplicaciones, mediciones y alertas.
- Cualquier token no clínico se trata como ciudadano: sólo puede leer menores con una relación activa. Un acceso ajeno responde 404 para no filtrar información clínica.

## Endpoints

Todos los endpoints `/api/v1` usan `{ valid, data, msg }`. Están disponibles los endpoints solicitados para menores/responsables, vacunas, esquemas/dosis, vacunación, mediciones, jornadas, alertas, campañas geográficas (`POST /jornadas/:id/notificar`) y reportes. Swagger: `/api/documentation`.

Las rutas, permisos y reglas de concurrencia se detallan en [API.md](API.md); la instalación, migración, seed y variables de operación en [OPERATIONS.md](OPERATIONS.md).

## Verificación funcional

La búsqueda protegida acepta nombre normalizado, prefijo o CUI completo y fecha `YYYY-MM-DD`; combina vacuna, estado, alertas y rango de última aplicación. Las consultas se mantienen dentro del territorio del perfil clínico; el administrador global no recibe ese recorte. El ciudadano no usa el índice clínico: obtiene solamente sus menores mediante una relación responsable activa y cualquier menor ajeno responde 404.

El QR crea un enlace opaco, revocable y con vencimiento. SCCVI guarda un selector, un verificador del enlace y un verificador de PIN con Argon2id y sales aleatorias; no guarda ninguno de los secretos recuperables. El PIN de seis dígitos se muestra una sola vez y debe entregarse por un canal distinto al QR. Cinco intentos fallidos bloquean el carné durante 15 minutos. Después de verificar el PIN se muestran el nombre, las vacunas y el último control de crecimiento; nunca CUI, dirección, responsables, contactos ni notas. Una nueva emisión revoca el QR anterior.

## Operación

`SSO_SERVICE_TOKEN` es una credencial de servicio inyectada en el runtime y no se persiste. Como alternativa se pueden inyectar `SSO_SERVICE_USERNAME` y `SSO_SERVICE_PASSWORD`; el Compose no contiene credenciales predeterminadas. El worker no guarda ni acepta email, teléfono, WhatsApp ni Telegram desde requests SCCVI. Los destinos sólo se resuelven desde SSO durante el despacho.
