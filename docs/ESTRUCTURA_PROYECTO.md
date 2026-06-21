# Estructura del Proyecto — Ola Chat

> Chat en tiempo real con WebSockets nativos, Redis Pub/Sub y PostgreSQL.
> Arquitectura de **Monolito Modular** lista para múltiples servidores.

---

## Árbol de directorios

```
Proyecto_Chat-de-WebSockets/
├── server.js                          # Punto de entrada Node.js
├── src/                               # Backend (Node.js / CommonJS)
│   ├── app.js                         # Bootstrap: HTTP + WebSocket + Redis
│   ├── config.js                      # Constantes y variables de entorno
│   ├── database/
│   │   └── pool.js                    # Pool de conexiones PostgreSQL
│   ├── redis/
│   │   ├── clients.js                 # Clientes publisher / subscriber
│   │   ├── publisher.js               # publishCluster() — incluye originServerId
│   │   └── clusterEvents.js           # handleClusterEvent() — filtra originServerId
│   ├── websocket/
│   │   ├── server.js                  # Servidor WS nativo (ws library)
│   │   ├── handlers.js                # Router de mensajes por tipo
│   │   └── helpers.js                 # broadcastLocal / sendToLocalUser
│   ├── utils/
│   │   ├── rateLimiter.js             # Rate limiter por ventana de tiempo
│   │   └── validators.js              # Validaciones compartidas
│   └── modules/                       # Módulos de dominio (handler→service→repo→pool)
│       ├── auth/
│       ├── messages/
│       │   └── messages.repository.js
│       ├── groups/
│       │   └── groups.repository.js
│       ├── profiles/
│       │   └── profiles.repository.js
│       ├── reactions/
│       │   ├── reactions.repository.js
│       │   └── reactions.service.js
│       ├── typing/
│       │   └── typing.service.js
│       └── moderation/
│
├── public/                            # Frontend estático (ES Modules)
│   ├── index.html                     # HTML único — carga css/* y js/app.js
│   ├── css/                           # 10 archivos CSS divididos
│   │   ├── variables.css              # Custom properties, tema claro/oscuro
│   │   ├── reset.css
│   │   ├── layout.css
│   │   ├── components.css
│   │   ├── messages.css
│   │   ├── forms.css
│   │   ├── modals.css
│   │   ├── animations.css
│   │   ├── responsive.css
│   │   └── scrollbars.css             # Scrollbars con gradiente oscuro
│   ├── js/                            # Módulos ES frontend
│   │   ├── app.js                     # Orquestador — punto de entrada
│   │   ├── state.js                   # Estado global + referencias DOM
│   │   ├── socket.js                  # Conexión WebSocket + reconexión
│   │   ├── dispatch.js                # Router de mensajes del servidor
│   │   ├── shared/
│   │   │   ├── utils.js               # sanitizeInput, formatTime, getInitials
│   │   │   ├── storage.js             # localStorage (estado local, unread counts)
│   │   │   └── popover.js             # Manager centralizado de popovers
│   │   └── modules/
│   │       ├── auth.js                # Login, registro, estado de sesión
│   │       ├── session.js             # Persistencia de sesión (localStorage)
│   │       ├── login.js               # Validación de formularios de auth
│   │       ├── navigation.js          # Tabs de sección, sidebar toggle
│   │       ├── chatList.js            # Lista lateral de chats
│   │       ├── chatSelect.js          # Selección de chat activo
│   │       ├── chatShell.js           # Shell del chat activo (header + perfil)
│   │       ├── messageRender.js       # Renderizado de mensajes
│   │       ├── messageHandlers.js     # Handlers de eventos de mensajes WS
│   │       ├── messageMenu.js         # Menú flotante WA-style (editar, borrar, reenviar)
│   │       ├── messageActions.js      # Eliminar para mí/todos, undo toast
│   │       ├── messageReply.js        # Sistema de respuesta/cita
│   │       ├── reactions.js           # Reacciones — fuente de verdad en memoria (no localStorage)
│   │       ├── search.js              # Búsqueda en conversación, menús
│   │       ├── groups.js              # Grupos — crear, invitar, moderar
│   │       ├── typingContext.js       # Contexto de chat activo para typing
│   │       ├── typing.js              # Indicador "está escribiendo"
│   │       ├── mobileActions.js       # isMobile(), attachLongPress()
│   │       ├── profile.js             # Caché de perfiles, popups de perfil
│   │       ├── profileModal.js        # Modal de edición de perfil propio
│   │       ├── privateChat.js         # Envío y recepción de mensajes privados
│   │       ├── emojiPicker.js         # Selector de emojis
│   │       └── moderationSettings.js  # Botón de censura
│   └── sounds/
│       └── notify.js                  # Sonido de notificación
│
├── tests/
│   ├── unit.test.js
│   ├── integration.test.js
│   └── e2e.test.js
├── docs/
│   └── ESTRUCTURA_PROYECTO.md         # Este archivo
└── config/
    └── moderation_terms.seed.json
```

---

## Flujo de datos

```
Cliente (Browser)
  ↓ WebSocket
src/websocket/server.js
  ↓ routing
src/websocket/handlers.js
  ↓ lógica
src/modules/<dominio>/handler.js
  ↓ negocio
src/modules/<dominio>/service.js
  ↓ datos
src/modules/<dominio>/repository.js
  ↓ SQL
src/database/pool.js (PostgreSQL)
  ↓ evento de cluster
src/redis/publisher.js → Redis Pub/Sub → src/redis/clusterEvents.js
```

---

## Decisiones de arquitectura

| Decisión | Razón |
|---|---|
| Sin Express, sin Socket.IO | Menor overhead; control total sobre el protocolo WS |
| ES Modules en frontend | Importaciones estáticas, tree-shaking, circular imports seguros |
| Reacciones en memoria (no localStorage) | PostgreSQL es la fuente de verdad; snapshots al cargar historial |
| `originServerId` en Redis events | Previene doble entrega cuando un servidor recibe su propio evento |
| CSS en 10 archivos | Separación por responsabilidad; fácil de mantener y sobreescribir por tema |
| `popover.js` centralizado | Solo un popover abierto a la vez; limpieza automática de listeners |

---

## Jerarquía Z-index

| Capa | Rango |
|---|---|
| Contenido / sidebar | 1–60 |
| Popovers / tooltips | 80–90 |
| Menú contextual | 420–422 |
| Diálogos de confirmación | 500 |
| Modales | 600 |
| Splash screen | 9999 |
| Toasts | 10 000+ |
