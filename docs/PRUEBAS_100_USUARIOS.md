# Pruebas con 100 usuarios y 300 mensajes

## Requisitos

Antes de ejecutar la prueba:

```bash
npm install
cp .env.example .env
docker compose up -d
npm run dev:server1
npm run dev:server2
```

En Windows PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d
npm run dev:server1
npm run dev:server2
```

## Ejecutar prueba estándar

```bash
npm run test:100
```

La prueba estándar crea:

```text
100 usuarios simulados
300 mensajes globales
2 servidores WebSocket
```

## Personalizar prueba

Linux/macOS/Git Bash:

```bash
TEST_USERS=100 TEST_MESSAGES=300 SERVER_URLS=ws://localhost:3000,ws://localhost:3001 npm run test:100
```

Windows PowerShell:

```powershell
$env:TEST_USERS="100"
$env:TEST_MESSAGES="300"
$env:SERVER_URLS="ws://localhost:3000,ws://localhost:3001"
npm run test:100
```

## Qué valida el script

- Que los 100 usuarios se registren/autentiquen.
- Que los usuarios se distribuyan entre servidores.
- Que los mensajes se reciban por WebSocket.
- Que Redis propague los eventos entre servidores.
- Que PostgreSQL conserve el historial esperado.

## Interpretación del resultado

Si todo está correcto, debe mostrar algo parecido a:

```text
Usuarios autenticados: 100
Errores de autenticación: 0
Broadcasts esperados: 30000
Cobertura de entrega: 95% o más
Mensajes globales almacenados en PostgreSQL: 300
```

Si la cobertura baja de 95%, revisar:

- Que ambos servidores estén encendidos.
- Que ambos usen la misma `REDIS_URL`.
- Que ambos usen la misma `DATABASE_URL`.
- Que no haya firewall bloqueando puertos.
- Que la computadora no esté saturada.
