# @cupidilla/api

API de Cupidilla: NestJS 12 con Drizzle ORM sobre PostgreSQL 18. Solo la llama el servidor de la web (`apps/web`), con la cabecera `X-Internal-Api-Key`; ningún navegador habla con ella.

- Diseño: [H0 — Diseño técnico](../../docs/h0-diseno-tecnico.md), §5 a §10.
- Arranque, variables y tests: [README de la raíz](../../README.md#clonar-y-arrancar). Las variables se leen del `.env` de la raíz.
- Scripts propios: `npm run test:unit` y `npm run test:int` (en esta carpeta). Para crear una migración, desde la raíz: `npm run db:generate -- --name <nombre_en_snake_case>`.
- Lee `AGENTS.md` antes de tocar el código: NestJS 12 es reciente y la documentación de terceros suele ser de versiones anteriores.
