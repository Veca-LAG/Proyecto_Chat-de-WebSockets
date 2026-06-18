# Guía para no subir información sensible a GitHub

## Archivos que no deben subirse

No subir:

```text
node_modules/
.env
data/db.json
logs/
*.log
dist/
build/
coverage/
```

## Archivos que sí se suben

Sí subir:

```text
.env.example
.env.server2.example
.env.server2-red.example
data/db.example.json
package.json
docker-compose.yml
server.js
public/
docs/
tests/
scripts/
```

## Comando recomendado antes de hacer commit

```bash
git status
```

Si aparece `node_modules`, `.env` o `data/db.json`, no hagan commit.

## Si ya agregaron archivos por error

Quitar `node_modules` del seguimiento de Git:

```bash
git rm -r --cached node_modules
```

Quitar `.env` y `data/db.json`:

```bash
git rm --cached .env data/db.json
```

Después:

```bash
git add .gitignore
git commit -m "Limpiar archivos sensibles"
```

## Activar bloqueo automático antes de commit

Una vez que el repositorio ya tenga `.git`, ejecutar:

```bash
npm run setup:hooks
```

Ese comando instala un hook `pre-commit` que ejecuta:

```bash
npm run check:sensitive
```

Si alguien intenta versionar archivos sensibles, el commit se bloquea.

## Revisión automática en GitHub

El proyecto incluye:

```text
.github/workflows/check-sensitive-files.yml
```

Esta acción revisa cada push o pull request para detectar archivos sensibles versionados.
