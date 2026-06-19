# Mejoras implementadas: mensajes, grupos y moderación

## Mensajes
- Barra de respuesta fuera del formulario para evitar que el input se desconfigure.
- Cada respuesta conserva el `id` del mensaje origen y una miniatura con autor/texto.
- Reenvíos con `isForwarded: true` y etiqueta visual "Mensaje reenviado".
- Menú de mensaje flotante estilo WhatsApp, con soporte de clic derecho en escritorio y pulsación larga en móvil.
- Modal de eliminación rediseñado con "Eliminar para mí" y "Eliminar para todos".
- "Eliminar para todos" ya no borra físicamente el mensaje del historial visual: ahora muestra "Eliminaste este mensaje" o "Se eliminó este mensaje".

## Reacciones
- Las reacciones se guardan en PostgreSQL en `message_reactions`.
- Se sincronizan por Redis Pub/Sub para varios servidores.
- El frontend actualiza la barra de reacciones en tiempo real.

## Emojis
- El selector permanece abierto para insertar varios emojis.
- Se cierra solo al hacer clic fuera del selector.

## Grupos
- El creador queda como `owner`.
- El owner puede nombrar administradores.
- Owner/admin pueden eliminar grupo para todos.
- Cualquier usuario puede salir del grupo o eliminar el chat solo de su barra lateral.

## Moderación
- La censura se ejecuta en el servidor antes del broadcast.
- Cada socket tiene preferencia propia: censura activada por defecto.
- El servidor envía texto censurado u original según la preferencia del usuario.
- Incluye normalización antievasión y dos enfoques: RegEx nativo y opción opcional con `bad-words`.
