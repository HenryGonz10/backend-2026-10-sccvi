# Catálogo de vacunación DEMO

`npm run seed:demo` instala `PAI-GT-DEMO-2026`: datos exclusivamente ficticios
para demostrar altas, reglas de secuencia, historial y reportes. No es un PAI
vigente, una norma MSPAS ni una fuente de prescripción clínica.

El código histórico `PAI-GT-REGULAR-2021` se conserva solo para que las
aplicaciones ya registradas puedan seguir leyéndose. El seed lo deja inactivo y
con vigencia final `2025-12-31`; no se selecciona como catálogo actual.

## Regla de actualización

No se debe activar ningún esquema real hasta contar con la fuente aprobada por
el programa de inmunizaciones del MSPAS, su versión, vigencias, dosis, edades,
intervalos y checksum. Esa actualización debe crear un código nuevo, conservar
las aplicaciones históricas y documentar la aprobación; no se deben editar las
definiciones usadas por registros clínicos existentes.

La dosis recurrente demostrativa conserva `secuencia`, de modo que una nueva
aplicación nunca sobrescribe una anterior. Esto prueba el comportamiento del
sistema, no la validez clínica del calendario.
