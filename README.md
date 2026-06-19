# Ola — Chat WebSocket escalable

Aplicación de chat en tiempo real desarrollada con **Node.js**, **WebSockets**, **Redis Pub/Sub**, **PostgreSQL**, **HTML5**, **CSS3** y **JavaScript Vanilla**.

Esta versión conserva los cambios actuales del equipo: interfaz tipo Discord/WhatsApp, logo de Ola, login/registro, usuarios conectados, privados, comunidades, invitaciones, búsqueda, notificaciones, modo claro/oscuro y mejoras visuales. Además, reemplaza `data/db.json` por una arquitectura distribuida preparada para varios servidores.

## Integrantes

- Mane Isabela Velasco Naranjo — DevOps & Backend Lead
- Heriberto Gómez Bolaina — Frontend Architect
- Nélida López Cruz — Real-Time Specialist
- Alondra Galvan German — UI/UX & Multimedia
- Abril Azeneth Quintas Rojas — Data & State Manager

## Objetivo

Implementar un chat en tiempo real mediante WebSockets que pueda ejecutarse en múltiples instancias de servidor, compartir eventos entre servidores y almacenar historial de mensajes de forma persistente.

## Arquitectura

```text
Clientes Web ── WebSocket ── Servidor 1 :3000 ┐
                                              ├── Redis Pub/Sub
Clientes Web ── WebSocket ── Servidor 2 :3001 ┘
                         │
                         └── PostgreSQL
```

## Qué incluye

| Requisito | Estado |
|---|---|
| WebSockets en tiempo real | Cumplido |
| Varios servidores conectados entre sí | Cumplido con Redis Pub/Sub |
| Historial mínimo de 300 mensajes | Cumplido con `MAX_HISTORY=300` |
| Persistencia sin `db.json` | Cumplido con PostgreSQL |
| Prueba de 100 usuarios | Incluida en `tests/load-test-100.js` |
| Proyecto limpio para GitHub | Incluye `.gitignore`, hook y GitHub Action |
| Conexión desde otras computadoras | Usa `HOST=0.0.0.0` |

## Estructura principal

```text
Proyecto_Chat_WebSockets_Escalable_Actualizado/
├── server.js
├── package.json
├── docker-compose.yml
├── .env.example
├── .env.server2.example
├── .env.server2-red.example
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── assets/img/logoOla.png
│   ├── modules/
│   ├── emoji/
│   └── sounds/
├── docs/
├── scripts/
├── tests/
└── data/db.example.json
```

## Instalación

```bash
npm install
```

Copiar configuración:

```bash
cp .env.example .env
```

En Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Levantar PostgreSQL y Redis:

```bash
docker compose up -d
```

## Correr un servidor

```bash
npm start
```

Entrar desde la misma computadora:

```text
http://localhost:3000
```

Entrar desde otra computadora de la red:

```text
http://IP-DE-LA-COMPUTADORA:3000
```

Ejemplo:

```text
http://192.168.137.1:3000
```

## Correr dos servidores en la misma computadora

Terminal 1:

```bash
npm run dev:server1
```

Terminal 2:

```bash
npm run dev:server2
```

Entrar a:

```text
http://localhost:3000
http://localhost:3001
```

Ambos servidores usan el mismo Redis y PostgreSQL, por eso los usuarios pueden comunicarse aunque entren por puertos diferentes.

## Correr dos servidores en computadoras diferentes

### Computadora A

Esta computadora tendrá PostgreSQL, Redis y el servidor 1.

```bash
docker compose up -d
npm run dev:server1
```

Ejemplo de acceso:

```text
http://192.168.137.1:3000
```

### Computadora B

Esta computadora tendrá el servidor 2. Debe apuntar a PostgreSQL y Redis de la computadora A.

Usa como base:

```text
.env.server2-red.example
```

Cambia `192.168.137.1` por la IP real de la computadora A:

```env
DATABASE_URL=postgresql://chatuser:chatpass@192.168.137.1:5432/chatdb
REDIS_URL=redis://:chat_redis_password@192.168.137.1:6379
```

Luego ejecuta:

```bash
npm start
```

## Prueba de 100 usuarios y 300 mensajes

Con los servidores activos:

```bash
npm run test:100
```

También puedes configurar la prueba:

```bash
TEST_USERS=100 TEST_MESSAGES=300 npm run test:100
```

En Windows PowerShell:

```powershell
$env:TEST_USERS="100"; $env:TEST_MESSAGES="300"; npm run test:100
```

## Archivos que no deben subirse a GitHub

No suban:

```text
node_modules/
.env
data/db.json
logs/
dist/
build/
coverage/
```

Este proyecto ya incluye `.gitignore`, pero si alguno de esos archivos ya fue agregado antes, quítenlo del control de Git con:

```bash
git rm -r --cached node_modules
git rm --cached .env data/db.json
```

Instalar hook de pre-commit:

```bash
npm run setup:hooks
```

Revisar archivos sensibles:

```bash
npm run check:sensitive
```

## Documentación adicional

- `docs/ARQUITECTURA_DISTRIBUIDA.md`
- `docs/GUIA_GITHUB.md`
- `docs/PRUEBAS_100_USUARIOS.md`

## Nota importante

`data/db.json` queda únicamente como referencia antigua y está bloqueado por `.gitignore`. La versión distribuida guarda datos en PostgreSQL y usa Redis para comunicación entre servidores.

---

## Moderación y censura escalable

El proyecto incluye un sistema de censura diseñado para funcionar con **varios servidores WebSocket al mismo tiempo**.

### Arquitectura elegida

```text
Servidor WebSocket 1 ┐
                     ├── PostgreSQL: catálogo moderation_terms
Servidor WebSocket 2 ┘
        │
        └── Redis: evento moderation_terms_updated
```

La censura se aplica en `server.js`, antes de enviar el mensaje a los demás clientes. Esto evita que alguien pueda saltarse el filtro modificando el frontend.

### Catálogo de términos

El catálogo base está en:

```text
config/moderation_terms.seed.json
```

Ese archivo se importa a PostgreSQL. Todos los servidores leen desde la misma base de datos y mantienen una copia en memoria para mejorar el rendimiento.

### Importar o actualizar palabras prohibidas

Con PostgreSQL y Redis levantados:

```powershell
npm run moderation:import
```

Este comando actualiza la tabla `moderation_terms` y avisa por Redis a los servidores para que recarguen la caché.

### Toggle por usuario

Cada usuario puede activar o desactivar la censura desde la interfaz. Esa preferencia se guarda en PostgreSQL en la tabla:

```text
user_moderation_preferences
```

Por defecto, la censura está activada.

### Documentación detallada

Ver:

```text
docs/MODERACION_ESCALABLE.md
```
