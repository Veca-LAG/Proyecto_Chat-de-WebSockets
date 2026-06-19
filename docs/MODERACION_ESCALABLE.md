# Moderación y censura escalable

Esta versión usa una solución de moderación pensada para varios servidores WebSocket.

## Opción implementada

Se eligió una solución propia basada en:

- **PostgreSQL** como catálogo central de términos prohibidos.
- **Caché en memoria por servidor** para no consultar la base en cada mensaje.
- **Redis Pub/Sub** para avisar a todos los servidores cuando el catálogo cambia.
- **Censura en backend**, antes de transmitir mensajes a los clientes.
- **Toggle por usuario**, guardado en PostgreSQL.

No se usa `bad-words` como motor principal porque no cubre bien español regional ni variantes escritas con espacios, puntos, números u homóglifos. El filtro propio es más controlable y más estable para el proyecto.

## Tablas agregadas

```sql
moderation_terms
user_moderation_preferences
moderation_audit
```

### `moderation_terms`

Guarda el catálogo central:

- `term`: palabra o frase original.
- `normalized_term`: versión normalizada para búsqueda.
- `country_code`: país o región, por ejemplo `MEX`, `COL`, `ESP`, `ALL`.
- `severity`: nivel de severidad.
- `category`: tipo de término.
- `source`: fuente de origen.
- `active`: indica si se usa actualmente.

### `user_moderation_preferences`

Guarda si cada usuario quiere ver censura activada o desactivada.

Por defecto:

```text
censorship_enabled = true
```

### `moderation_audit`

Guarda eventos donde el filtro encontró términos prohibidos. No bloquea el mensaje; solo registra coincidencias.

## Catálogo inicial

El archivo base está en:

```text
config/moderation_terms.seed.json
```

Incluye términos derivados de:

- lista local del proyecto,
- lista enviada por el usuario,
- dataset `spanlp` por países,
- lista básica en inglés.

Algunos términos ambiguos o que pueden causar falsos positivos se insertan como `active: false`. Pueden activarse después desde PostgreSQL si el equipo decide usarlos.

## Importar o actualizar catálogo

Con Docker/PostgreSQL levantado:

```powershell
npm run moderation:import
```

Ese comando:

1. Lee `config/moderation_terms.seed.json`.
2. Inserta o actualiza términos en PostgreSQL.
3. Publica un evento Redis para que todos los servidores recarguen la caché.

## Cómo recargan los servidores

Cada servidor carga los términos al iniciar:

```text
PostgreSQL -> caché local del servidor
```

Cuando se ejecuta `npm run moderation:import`, se publica:

```text
moderation_terms_updated
```

Los servidores escuchan ese evento y recargan la lista sin reiniciarse.

## Cómo se censura un mensaje

1. El cliente manda el texto original.
2. `server.js` limpia el texto con `sanitizeText`.
3. El filtro busca términos activos desde la caché local.
4. Se guarda:
   - `text_original`
   - `text_censored`
5. Al transmitir, cada socket recibe la versión según su preferencia:
   - censura activada: `text_censored`
   - censura desactivada: `text_original`

## Variantes detectadas

El filtro detecta variantes con:

- mayúsculas/minúsculas,
- acentos,
- puntos intermedios,
- espacios intermedios,
- guiones,
- números/homóglifos: `0 -> o`, `1 -> i`, `3 -> e`, `4 -> a`, `5 -> s`, `7 -> t`, `@ -> a`, `$ -> s`.

Ejemplos:

```text
p.a.l.a.b.r.a
p a l a b r a
p4l4br4
```

## Por qué esta opción escala mejor

- Todos los servidores usan la misma fuente: PostgreSQL.
- No se consulta PostgreSQL por cada mensaje; se usa caché local.
- Redis sincroniza cambios en caliente.
- El toggle de censura se guarda por usuario.
- El filtro vive en backend, por lo que no puede evadirse modificando el frontend.

## Nota importante

Ningún filtro de groserías es perfecto. Para reducir falsos positivos, el catálogo debe mantenerse y ajustarse. Por eso esta versión permite activar/desactivar términos desde la tabla `moderation_terms`.
