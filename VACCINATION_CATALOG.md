# Catálogo de vacunación de demostración

El seed `npm run seed:demo` instala el esquema **PAI-GT-REGULAR-2021**. Es un
catálogo versionado para pruebas locales, no una sustitución de una norma vigente
ni una fuente de prescripción clínica.

## Alcance contrastado

La secuencia pediátrica se contrastó con el carné de referencia proporcionado:

- BCG y hepatitis B al nacimiento.
- Pentavalente y fIPV a los 2 y 4 meses; pentavalente a los 6 meses.
- bOPV a los 6 y 18 meses, y a los 5 años.
- Rotavirus a los 2 y 4 meses; neumococo a los 2, 4 y 12 meses.
- SRP a los 12 y 18 meses; DPT a los 18 meses y 5 años.
- Influenza a los 6 y 7 meses, seguida por la dosis anual recurrente.

La tercera dosis de influenza usa `intervalo_repeticion_dias=365`. Las
aplicaciones clínicas llevan `secuencia`, por lo que una aplicación anual no
sobrescribe las anteriores. Peso y talla viven exclusivamente en
`sccvi_mediciones_antropometricas` y no requieren una vacuna.

## Actualización normativa

Al sustituir el esquema, cree un nuevo código y fecha de vigencia; no edite las
dosis ya usadas por historiales clínicos. La búsqueda oficial realizada el 31 de
octubre de 2026 localizó lineamientos MSPAS para COVID-19 y las *Normas de
atención en salud integral para primero y segundo nivel* (publicadas el 27 de
febrero de 2025), pero no una tabla pública más reciente del PAI regular que
reemplace de forma verificable esta referencia 2021. La aprobación y la fuente
normativa del nuevo PAI deben venir del programa de inmunizaciones del MSPAS.
