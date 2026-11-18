# Estándar OMS de crecimiento infantil

Los parámetros versionados de `who-cgs-2006-lms.json` se derivaron sin cambios
clínicos de los conjuntos LMS distribuidos por OMS en `igrowup-spss.zip`.
No son datos de pacientes ni una tabla estimada por SCCVI.

| Artefacto | Origen oficial | SHA-256 |
| --- | --- | --- |
| `igrowup-spss.zip` | https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/software/igrowup-spss.zip?sfvrsn=5fb221f_2 | `1143fe907b38a95b478866d2d6a8570d685176ae27950d18f20f3fd266d0443f` |
| `who-cgs-2006-lms.json` | Derivado de los cinco `.sav` LMS del ZIP mediante conversión de columnas exacta | `51c5c74cb059e0b86cb135db76e453f93916ffffc3656448594aa2b8950860b7` |

La implementación conserva como evidencia por evaluación: estándar, hash, indicador,
curva sexual, edad exacta, tipo de medición, valor de entrada y parámetros L/M/S.
La corrección de 0.7 cm y el tratamiento de Z extrema siguen el macro OMS
`igrowup.sps` contenido en el ZIP. Véanse también las tablas oficiales archivadas
en `source/` y https://www.who.int/tools/child-growth-standards/software.
