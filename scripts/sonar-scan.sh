#!/usr/bin/env bash
# Análisis local con SonarQube (npm run sonar:scan). Requiere `npm run sonar:up` y
# SONAR_LOCAL_TOKEN en .env. No imprime el token.
set -euo pipefail
cd "$(dirname "$0")/.."

SCANNER_IMAGE="sonarsource/sonar-scanner-cli:12.4.0.4321_8.4.0"

# Se lee solo SONAR_LOCAL_TOKEN del .env (sin ejecutarlo ni cargar el resto).
if [ -z "${SONAR_LOCAL_TOKEN:-}" ] && [ -f .env ]; then
  SONAR_LOCAL_TOKEN="$(grep -E '^SONAR_LOCAL_TOKEN=' .env | tail -n1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true)"
fi
if [ -z "${SONAR_LOCAL_TOKEN:-}" ]; then
  echo "Falta SONAR_LOCAL_TOKEN (en .env o en el entorno). Mira la sección «Calidad de código» del README." >&2
  exit 1
fi

# El token viaja por entorno (no en la línea de comandos) para que no salga en `ps`.
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e SONAR_TOKEN="$SONAR_LOCAL_TOKEN" \
  -e SONAR_HOST_URL=http://localhost:9000 \
  -v "$PWD:/usr/src" \
  "$SCANNER_IMAGE" \
  -Dsonar.projectKey=cupidilla \
  -Dsonar.organization=
