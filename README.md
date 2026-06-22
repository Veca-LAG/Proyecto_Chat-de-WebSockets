# Ola - Chat WebSocket Distribuido

**Ola** es una aplicación de chat en tiempo real desarrollada con **Node.js**, **WebSockets nativos**, **PostgreSQL** y **Redis Pub/Sub**.
El proyecto está diseñado para funcionar con uno o varios servidores al mismo tiempo, permitiendo comunicación en tiempo real entre usuarios conectados a diferentes instancias del servidor.

---

## 1. Tecnologías utilizadas

* Node.js
* WebSockets nativos con `ws`
* PostgreSQL
* Redis Pub/Sub
* Docker Compose
* HTML, CSS y JavaScript Vanilla
* Arquitectura modular por funcionalidades

---

## 2. Funcionalidades principales

El sistema incluye:

* Registro e inicio de sesión de usuarios.
* Chat global en tiempo real.
* Chat privado entre usuarios.
* Grupos o comunidades.
* Historial de mensajes.
* Respuestas a mensajes.
* Reenvío de mensajes.
* Edición de mensajes.
* Eliminación de mensajes.
* Reacciones con emojis.
* Indicador de escritura.
* Perfil de usuario.
* Estado de conexión.
* Moderación/censura de palabras.
* Soporte para varios servidores usando Redis Pub/Sub.
* Persistencia de datos en PostgreSQL.
* Prueba de carga para 100 usuarios.

---

## 3. Arquitectura general

El proyecto usa una arquitectura modular.

```text
server.js
src/
public/
scripts/
tests/
docs/
config/
docker-compose.yml
package.json
```

### Punto de entrada

El archivo `server.js` se encuentra en la raíz del proyecto.
Esto es correcto porque funciona únicamente como punto de entrada.

```js
require('dotenv').config();

require('./src/app').start().catch((error) => {
    console.error('No se pudo iniciar el servidor:', error);
    process.exit(1);
});
```

Toda la lógica real del servidor debe estar dentro de `src/`.

---

## 4. Estructura del proyecto

```text
Proyecto/
│
├── server.js
├── package.json
├── package-lock.json
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
│
├── config/
│   └── moderation_terms.seed.json
│
├── data/
│   ├── .gitkeep
│   └── db.example.json
│
├── docs/
│   ├── ARQUITECTURA_DISTRIBUIDA.md
│   ├── ESTRUCTURA_PROYECTO.md
│   ├── GUIA_GITHUB.md
│   ├── MODERACION_ESCALABLE.md
│   └── PRUEBAS_100_USUARIOS.md
│
├── scripts/
│   ├── import-moderation-terms.js
│   ├── check-git-sensitive-files.js
│   └── setup-git-hooks.js
│
├── tests/
│   ├── unit.test.js
│   ├── integration.test.js
│   ├── e2e.test.js
│   └── load-test-100.js
│
├── src/
│   ├── app.js
│   ├── config.js
│   ├── http.js
│   │
│   ├── db/
│   │   ├── pool.js
│   │   └── schema.js
│   │
│   ├── redis/
│   │   ├── clients.js
│   │   ├── publisher.js
│   │   └── clusterEvents.js
│   │
│   ├── websocket/
│   │   ├── router.js
│   │   ├── helpers.js
│   │   └── state.js
│   │
│   ├── utils/
│   │   ├── logger.js
│   │   ├── presence.js
│   │   ├── sanitize.js
│   │   ├── validators.js
│   │   └── rateLimiter.js
│   │
│   └── modules/
│       ├── auth/
│       ├── messages/
│       ├── reactions/
│       ├── groups/
│       ├── profiles/
│       ├── moderation/
│       └── typing/
│
└── public/
    ├── index.html
    │
    ├── assets/
    │   ├── img/
    │   ├── sounds/
    │   └── icons/
    │
    ├── css/
    │   ├── variables.css
    │   ├── layout.css
    │   ├── sidebar.css
    │   ├── chat.css
    │   ├── messages.css
    │   ├── reactions.css
    │   ├── profile.css
    │   ├── modals.css
    │   ├── scrollbars.css
    │   └── responsive.css
    │
    └── js/
        ├── app.js
        ├── socket.js
        ├── state.js
        ├── dom.js
        ├── dispatch.js
        │
        ├── modules/
        │   ├── login.js
        │   ├── session.js
        │   ├── globalChat.js
        │   ├── privateChat.js
        │   ├── groups.js
        │   ├── users.js
        │   ├── history.js
        │   ├── messages.js
        │   ├── messageMenu.js
        │   ├── messageReply.js
        │   ├── reactions.js
        │   ├── profile.js
        │   ├── profilePopover.js
        │   ├── profileModal.js
        │   ├── presence.js
        │   ├── emojiPicker.js
        │   ├── typing.js
        │   ├── mobileActions.js
        │   └── moderationSettings.js
        │
        └── shared/
            ├── popover.js
            ├── escapeHtml.js
            ├── formatTime.js
            ├── storage.js
            ├── validators.js
            └── events.js
```

---

## 5. Requisitos previos

Antes de ejecutar el proyecto, instala:

* Node.js 18 o superior.
* Docker Desktop.
* Git.
* Un navegador moderno.

Verifica las versiones:

```powershell
node -v
npm -v
docker -v
git --version
```

---

## 6. Instalación inicial

Clona o descarga el proyecto y entra a la carpeta raíz.

```powershell
cd Proyecto_Chat-de-WebSockets
```

Instala las dependencias:

```powershell
npm install
```

Copia el archivo de variables de entorno:

```powershell
Copy-Item .env.example .env
```

En Linux o macOS:

```bash
cp .env.example .env
```

---

## 7. Variables de entorno

El archivo `.env` debe tener una configuración similar a esta:

```env
HOST=0.0.0.0
PORT=3000
SERVER_ID=server-1

POSTGRES_USER=chatuser
POSTGRES_PASSWORD=chatpass
POSTGRES_DB=chatdb
DATABASE_URL=postgresql://chatuser:chatpass@localhost:5432/chatdb

REDIS_PASSWORD=chat_redis_password
REDIS_URL=redis://:chat_redis_password@localhost:6379
REDIS_CHANNEL=chat_cluster_events

MAX_HISTORY=300
MAX_MESSAGE_LENGTH=300
RATE_LIMIT_WINDOW_MS=10000
RATE_LIMIT_MAX_MESSAGES=30
HEARTBEAT_INTERVAL_MS=30000
```

### Importante

No subas el archivo `.env` a GitHub.
Solo debe subirse `.env.example`.

---

## 8. Levantar PostgreSQL y Redis

El proyecto usa Docker Compose para iniciar PostgreSQL y Redis.

Ejecuta:

```powershell
docker compose up -d
```

Verifica que los contenedores estén activos:

```powershell
docker ps
```

Deberías ver contenedores para:

```text
PostgreSQL
Redis
```

---

## 9. Importar palabras de moderación

Después de levantar Docker, importa las palabras de moderación:

```powershell
npm run moderation:import
```

Este comando carga los términos desde:

```text
config/moderation_terms.seed.json
```

---

## 10. Ejecutar un solo servidor

Para correr el servidor principal:

```powershell
npm run dev:server1
```

Abre en el navegador:

```text
http://localhost:3000
```

---

## 11. Ejecutar dos servidores en la misma computadora

Para probar la arquitectura distribuida en una sola computadora, abre dos terminales.

### Terminal 1

```powershell
npm run dev:server1
```

Servidor 1:

```text
http://localhost:3000
```

### Terminal 2

```powershell
npm run dev:server2
```

Servidor 2:

```text
http://localhost:3001
```

Ambos servidores usan la misma base de datos PostgreSQL y el mismo Redis.

Esto permite probar que:

* Un usuario conectado en servidor 1 pueda hablar con otro usuario conectado en servidor 2.
* Los mensajes se sincronicen en tiempo real.
* Las reacciones se sincronicen.
* Los perfiles se actualicen.
* Los estados de conexión se compartan.
* Redis Pub/Sub funcione correctamente.

---

## 12. Ejecutar dos servidores en computadoras diferentes

También puedes correr el servidor 1 en una computadora y el servidor 2 en otra.

### Ejemplo

Computadora A:

```text
Servidor 1
PostgreSQL
Redis
```

Computadora B:

```text
Servidor 2
```

La computadora B debe conectarse a PostgreSQL y Redis de la computadora A.

---

## 13. Obtener la IP de la computadora principal

En la computadora A, ejecuta:

```powershell
ipconfig
```

Busca la IPv4 de tu red local.

Ejemplo:

```text
192.168.137.196
```

---

## 14. Configuración de la computadora A

En la computadora A, el `.env` puede quedar así:

```env
HOST=0.0.0.0
PORT=3000
SERVER_ID=server-1

POSTGRES_USER=chatuser
POSTGRES_PASSWORD=chatpass
POSTGRES_DB=chatdb
DATABASE_URL=postgresql://chatuser:chatpass@localhost:5432/chatdb

REDIS_PASSWORD=chat_redis_password
REDIS_URL=redis://:chat_redis_password@localhost:6379
REDIS_CHANNEL=chat_cluster_events

MAX_HISTORY=300
MAX_MESSAGE_LENGTH=300
RATE_LIMIT_WINDOW_MS=10000
RATE_LIMIT_MAX_MESSAGES=30
HEARTBEAT_INTERVAL_MS=30000
```

Ejecuta:

```powershell
docker compose up -d
npm run moderation:import
npm run dev:server1
```

---

## 15. Configuración de la computadora B

En la computadora B, el `.env` debe apuntar a la IP de la computadora A.

Ejemplo:

```env
HOST=0.0.0.0
PORT=3001
SERVER_ID=server-2

POSTGRES_USER=chatuser
POSTGRES_PASSWORD=chatpass
POSTGRES_DB=chatdb
DATABASE_URL=postgresql://chatuser:chatpass@192.168.137.196:5432/chatdb

REDIS_PASSWORD=chat_redis_password
REDIS_URL=redis://:chat_redis_password@192.168.137.196:6379
REDIS_CHANNEL=chat_cluster_events

MAX_HISTORY=300
MAX_MESSAGE_LENGTH=300
RATE_LIMIT_WINDOW_MS=10000
RATE_LIMIT_MAX_MESSAGES=30
HEARTBEAT_INTERVAL_MS=30000
```

Luego ejecuta en la computadora B:

```powershell
npm install
npm run dev:server2
```

Abre:

```text
http://localhost:3001
```

Desde otra computadora en la red también puedes entrar usando la IP:

```text
http://192.168.137.196:3000
```

o para servidor 2:

```text
http://IP-DE-COMPUTADORA-B:3001
```

---

## 16. Abrir puertos en Firewall de Windows

En la computadora A, abre PowerShell como administrador y ejecuta:

```powershell
New-NetFirewallRule -DisplayName "Chat WebSocket 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
New-NetFirewallRule -DisplayName "PostgreSQL 5432" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow
New-NetFirewallRule -DisplayName "Redis 6379" -Direction Inbound -Protocol TCP -LocalPort 6379 -Action Allow
```

Si usas servidor 2 en otra computadora, también puedes abrir el puerto 3001 en esa computadora:

```powershell
New-NetFirewallRule -DisplayName "Chat WebSocket 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

---

## 17. Probar conexión entre computadoras

Desde la computadora B, prueba conexión hacia la computadora A:

```powershell
ping 192.168.137.196
```

Prueba PostgreSQL:

```powershell
Test-NetConnection 192.168.137.196 -Port 5432
```

Prueba Redis:

```powershell
Test-NetConnection 192.168.137.196 -Port 6379
```

Debe aparecer:

```text
TcpTestSucceeded : True
```

---

## 18. Scripts disponibles

```json
{
  "start": "node server.js",
  "dev": "node server.js",
  "dev:server1": "cross-env HOST=0.0.0.0 PORT=3000 SERVER_ID=server-1 node server.js",
  "dev:server2": "cross-env HOST=0.0.0.0 PORT=3001 SERVER_ID=server-2 node server.js",
  "test": "node tests/unit.test.js && node tests/integration.test.js && node tests/e2e.test.js",
  "test:unit": "node tests/unit.test.js",
  "test:integration": "node tests/integration.test.js",
  "test:e2e": "node tests/e2e.test.js",
  "test:100": "node tests/load-test-100.js",
  "check:sensitive": "node scripts/check-git-sensitive-files.js",
  "setup:hooks": "node scripts/setup-git-hooks.js",
  "moderation:import": "node scripts/import-moderation-terms.js"
}
```

---

## 19. Ejecutar pruebas

Para ejecutar todas las pruebas:

```powershell
npm test
```

Para pruebas individuales:

```powershell
npm run test:unit
npm run test:integration
npm run test:e2e
```

---

## 20. Prueba de 100 usuarios

Para ejecutar la prueba de carga:

```powershell
npm run test:100
```

Esta prueba simula múltiples usuarios conectándose al servidor.

Antes de ejecutarla, asegúrate de que el servidor esté activo:

```powershell
npm run dev:server1
```

---

## 21. Validar que no se suban archivos sensibles

Antes de subir a GitHub, ejecuta:

```powershell
npm run check:sensitive
```

También revisa manualmente:

```powershell
git status
```

No deben subirse:

```text
node_modules/
.env
data/db.json
.git/
.claude/
```

El `.gitignore` debe incluir:

```gitignore
node_modules/
.env
.env.local
.env.*.local
data/db.json
*.log
dist/
build/
coverage/
.claude/
```

---

## 22. Flujo recomendado para subir cambios a GitHub

Primero revisa el estado:

```powershell
git status
```

Agrega los cambios:

```powershell
git add .
```

Crea un commit:

```powershell
git commit -m "Actualizar arquitectura y documentación del chat"
```

Sube los cambios:

```powershell
git push
```

---

## 23. Cómo probar que el tiempo real funciona

Abre dos navegadores o dos pestañas.

### Prueba en un solo servidor

1. Abre:

```text
http://localhost:3000
```

2. Inicia sesión con un usuario.

3. En otra pestaña abre otra sesión con otro usuario.

4. Envía un mensaje.

El mensaje debe aparecer sin recargar.

### Prueba con dos servidores

1. Abre:

```text
http://localhost:3000
```

2. Inicia sesión con un usuario.

3. Abre:

```text
http://localhost:3001
```

4. Inicia sesión con otro usuario.

5. Envía mensajes entre ambos.

Los mensajes deben aparecer en tiempo real aunque los usuarios estén en servidores diferentes.

---

## 24. Qué revisar si los mensajes no aparecen en tiempo real

Si los mensajes aparecen solo después de recargar, revisar:

### 1. WebSocket conectado

En la consola del navegador debe aparecer conexión activa.

### 2. Redis activo

Ejecuta:

```powershell
docker ps
```

Redis debe estar corriendo.

### 3. PostgreSQL activo

Ejecuta:

```powershell
docker ps
```

PostgreSQL debe estar corriendo.

### 4. Ambos servidores usan el mismo Redis

Revisa en `.env`:

```env
REDIS_URL=redis://:chat_redis_password@localhost:6379
```

o si es otra computadora:

```env
REDIS_URL=redis://:chat_redis_password@IP-DE-LA-PC-PRINCIPAL:6379
```

### 5. Ambos servidores usan la misma base de datos

Revisa:

```env
DATABASE_URL=postgresql://chatuser:chatpass@localhost:5432/chatdb
```

o si es otra computadora:

```env
DATABASE_URL=postgresql://chatuser:chatpass@IP-DE-LA-PC-PRINCIPAL:5432/chatdb
```

### 6. Redis no debe duplicar eventos

El sistema debe usar `originServerId` para evitar que un servidor procese dos veces sus propios eventos.

---

## 25. Problemas comunes

### Error: `Cannot find module 'dotenv'`

Ejecuta:

```powershell
npm install
```

---

### Error: puerto ocupado

Si el puerto 3000 ya está ocupado:

```powershell
netstat -ano | findstr :3000
```

Puedes cerrar el proceso o usar otro puerto.

---

### Docker dice que el contenedor ya existe

Ejecuta:

```powershell
docker stop chat-redis chat-postgres
docker rm chat-redis chat-postgres
docker compose up -d
```

---

### No puedo entrar desde otra computadora

Revisa:

* Que ambas computadoras estén en la misma red.
* Que estés usando la IP correcta.
* Que `HOST=0.0.0.0`.
* Que el Firewall permita el puerto.
* Que uses `http://IP:PUERTO`.

No uses:

```text
http://0.0.0.0:3000
```

En el navegador debes usar:

```text
http://localhost:3000
```

o:

```text
http://IP-DE-LA-PC:3000
```

---

## 26. Archivos importantes

### Backend

```text
src/app.js
```

Inicializa servidor, WebSocket, Redis y PostgreSQL.

```text
src/websocket/router.js
```

Recibe eventos WebSocket y los manda al módulo correspondiente.

```text
src/websocket/helpers.js
```

Contiene funciones para enviar mensajes a clientes.

```text
src/redis/publisher.js
```

Publica eventos entre servidores.

```text
src/redis/clusterEvents.js
```

Recibe eventos Redis desde otros servidores.

```text
src/db/schema.js
```

Crea o actualiza tablas necesarias.

---

### Frontend

```text
public/js/app.js
```

Inicializa la aplicación del navegador.

```text
public/js/socket.js
```

Maneja la conexión WebSocket.

```text
public/js/dispatch.js
```

Distribuye eventos recibidos del servidor.

```text
public/js/state.js
```

Estado global mínimo del frontend.

```text
public/js/modules/messages.js
```

Renderizado y manejo de mensajes.

```text
public/js/modules/reactions.js
```

Reacciones de mensajes.

```text
public/js/modules/profile.js
```

Caché y actualización visual de perfiles.

```text
public/js/modules/profilePopover.js
```

Popup rápido del perfil.

```text
public/js/modules/profileModal.js
```

Modal de edición del perfil.

```text
public/js/modules/presence.js
```

Estados de conexión.

---

## 27. Reglas de arquitectura

Para mantener el proyecto ordenado:

* No meter toda la lógica en `server.js`.
* No meter toda la lógica en `src/app.js`.
* No meter toda la lógica frontend en `public/js/app.js`.
* No crear un `style.css` gigante.
* Cada módulo debe tener una responsabilidad clara.
* Los estilos deben estar divididos por área.
* Las reacciones colaborativas no deben depender de `localStorage`.
* Los eventos entre servidores deben usar Redis Pub/Sub.
* PostgreSQL debe ser la fuente principal de datos persistentes.

---

## 28. Organización sugerida del equipo

| Integrante | Área principal                                          |
| ---------- | ------------------------------------------------------- |
| Mane       | Backend, Docker, PostgreSQL, Redis, configuración       |
| Heriberto  | Arquitectura frontend, navegación, módulos JS           |
| Nélida     | WebSockets, tiempo real, mensajes, reacciones           |
| Alondra    | UI/UX, CSS, responsive, logo, perfil visual             |
| Abril      | Datos, historial, repositorios, pruebas y documentación |

---

## 29. Orden recomendado para desarrollar

1. Verificar que Docker, PostgreSQL y Redis funcionen.
2. Ejecutar servidor 1.
3. Ejecutar servidor 2.
4. Probar login y registro.
5. Probar mensajes globales.
6. Probar mensajes privados.
7. Probar grupos.
8. Probar reacciones.
9. Probar perfiles.
10. Probar moderación.
11. Ejecutar pruebas.
12. Revisar que no se suban archivos sensibles.

---

## 30. Comandos rápidos

Instalar:

```powershell
npm install
```

Copiar variables:

```powershell
Copy-Item .env.example .env
```

Levantar Docker:

```powershell
docker compose up -d
```

Importar moderación:

```powershell
npm run moderation:import
```

Servidor 1:

```powershell
npm run dev:server1
```

Servidor 2:

```powershell
npm run dev:server2
```

Pruebas:

```powershell
npm test
```

Prueba 100 usuarios:

```powershell
npm run test:100
```

Revisar archivos sensibles:

```powershell
npm run check:sensitive
```

---

## 31. Estado esperado

Si todo está funcionando correctamente:

* El servidor 1 abre en `http://localhost:3000`.
* El servidor 2 abre en `http://localhost:3001`.
* Los usuarios pueden iniciar sesión.
* Los mensajes aparecen sin recargar.
* Las reacciones se actualizan en tiempo real.
* Los perfiles se sincronizan.
* Los estados de conexión se actualizan.
* Redis sincroniza eventos entre servidores.
* PostgreSQL guarda usuarios, mensajes, grupos, perfiles y reacciones.
* La prueba de 100 usuarios puede ejecutarse correctamente.

---
