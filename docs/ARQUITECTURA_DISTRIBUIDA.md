# Arquitectura distribuida

## Arquitectura anterior

```text
Clientes Web ── WebSocket ── Servidor Node.js ── data/db.json
```

Limitaciones:

- Un solo servidor central.
- Archivo JSON local como almacenamiento.
- No permite escalar a varios servidores sin perder sincronización.
- Riesgo de conflicto si dos procesos escriben el mismo archivo.

## Arquitectura nueva

```text
Cliente A ───────────────┐
Cliente B ───────────────┤
                         ▼
                  Servidor 1 :3000 ─────┐
                         │              │
                         │ Redis Pub/Sub│
                         │ PostgreSQL   │
                         │              │
                  Servidor 2 :3001 ─────┘
                         ▲
Cliente C ───────────────┤
Cliente D ───────────────┘
```

## Componentes

### Cliente Web

Usa HTML, CSS y JavaScript. Se conecta por WebSocket usando la dirección actual del navegador:

```js
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${wsProtocol}//${window.location.host}`);
```

Esto evita usar `localhost` quemado en el frontend.

### Servidores WebSocket

Cada servidor Node.js acepta conexiones persistentes de clientes. Pueden ejecutarse varias instancias en diferentes puertos o computadoras.

Ejemplo:

```text
server-1 → puerto 3000
server-2 → puerto 3001
```

### Redis Pub/Sub

Redis permite que los servidores compartan eventos de tiempo real:

- Mensajes globales.
- Mensajes privados.
- Mensajes de grupo.
- Usuarios conectados.
- Indicador de escritura.

### PostgreSQL

PostgreSQL guarda:

- Usuarios.
- Sesiones.
- Historial global.
- Historial privado.
- Grupos.
- Miembros de grupos.
- Mensajes de grupos.

## Flujo de un mensaje global

```text
1. Usuario A envía mensaje al Servidor 1.
2. Servidor 1 guarda el mensaje en PostgreSQL.
3. Servidor 1 publica el evento en Redis.
4. Servidor 1 y Servidor 2 reciben el evento por Redis.
5. Cada servidor reenvía el mensaje a sus propios clientes conectados.
```

## Escalabilidad horizontal

Para agregar otro servidor, se necesita:

```text
1. Copiar el proyecto en otra computadora o proceso.
2. Cambiar PORT y SERVER_ID.
3. Usar la misma DATABASE_URL.
4. Usar la misma REDIS_URL.
5. Ejecutar npm start.
```

Mientras todos los servidores usen el mismo PostgreSQL y Redis, podrán comunicarse entre sí.
