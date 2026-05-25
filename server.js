const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_HISTORY = 50;
const MAX_NICKNAME_LENGTH = 20;
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 300;
const MIN_PASSWORD_LENGTH = 6;
const SESSION_DAYS = 30;

const users = new Map(); // ws -> usuario público autenticado
const socketsByUserId = new Map(); // userId -> Set<WebSocket>
const inviteTokens = new Map(); // token -> groupId
let db = loadDatabase();

const server = http.createServer(handleHttpRequest);
const wss = new WebSocket.Server({ server });

/**
 * Atiende peticiones HTTP y sirve archivos estáticos desde public/.
 * @param {http.IncomingMessage} req Petición del navegador.
 * @param {http.ServerResponse} res Respuesta HTTP.
 */
function handleHttpRequest(req, res) {
    const requestedPath = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^([.][.][/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Acceso denegado');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('Archivo no encontrado');
            return;
        }

        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        res.end(content, 'utf-8');
    });
}

/**
 * Devuelve el tipo MIME de acuerdo con la extensión del archivo.
 * @param {string} filePath Ruta del archivo.
 * @returns {string} Tipo de contenido HTTP.
 */
function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.mp3': 'audio/mpeg'
    };

    return types[extension] || 'application/octet-stream';
}

/**
 * Carga la base de datos JSON del proyecto.
 * @returns {object} Datos persistidos.
 */
function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        if (!fs.existsSync(DB_FILE)) {
            const initialData = createEmptyDatabase();
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
            return initialData;
        }

        const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        return normalizeDatabase(parsed);
    } catch (error) {
        console.error('No se pudo cargar data/db.json. Se usará una base vacía.', error);
        return createEmptyDatabase();
    }
}

/**
 * Crea la estructura inicial de almacenamiento.
 * @returns {object} Base de datos vacía.
 */
function createEmptyDatabase() {
    return {
        users: [],
        sessions: [],
        globalHistory: [],
        privateMessages: [],
        groups: []
    };
}

/**
 * Garantiza que existan las colecciones necesarias.
 * @param {object} data Datos leídos.
 * @returns {object} Datos normalizados.
 */
function normalizeDatabase(data) {
    return {
        users: Array.isArray(data.users) ? data.users : [],
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
        globalHistory: Array.isArray(data.globalHistory) ? data.globalHistory : [],
        privateMessages: Array.isArray(data.privateMessages) ? data.privateMessages : [],
        groups: Array.isArray(data.groups) ? data.groups : []
    };
}

/**
 * Guarda la base de datos JSON de forma persistente.
 */
function saveDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/**
 * Registra eventos con timestamp legible.
 * @param {string} event Texto del evento.
 */
function logEvent(event) {
    const time = new Intl.DateTimeFormat('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date());
    console.log(`[${time}] ${event}`);
}

/**
 * Elimina etiquetas HTML y recorta un valor de texto.
 * @param {string} value Texto original.
 * @param {number} maxLength Longitud máxima.
 * @returns {string} Texto sanitizado.
 */
function sanitizeText(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>?/gm, '')
        .trim()
        .slice(0, maxLength);
}

/**
 * Normaliza un nickname para comparaciones únicas.
 * @param {string} nickname Nickname original.
 * @returns {string} Nickname normalizado.
 */
function normalizeNickname(nickname) {
    return String(nickname || '').trim().toLowerCase();
}

/**
 * Hashea una contraseña usando scrypt y salt aleatorio.
 * @param {string} password Contraseña en texto plano.
 * @returns {{salt:string,hash:string}} Salt y hash en hexadecimal.
 */
function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
}

/**
 * Verifica una contraseña contra el hash almacenado.
 * @param {string} password Contraseña ingresada.
 * @param {object} user Usuario almacenado.
 * @returns {boolean} True si coincide.
 */
function verifyPassword(password, user) {
    if (!user?.passwordSalt || !user?.passwordHash) {
        return false;
    }

    const testHash = scryptSync(password, user.passwordSalt, 64);
    const storedHash = Buffer.from(user.passwordHash, 'hex');

    if (storedHash.length !== testHash.length) {
        return false;
    }

    return timingSafeEqual(storedHash, testHash);
}

/**
 * Genera un código público único para mostrar en el perfil.
 * @returns {string} Código de usuario.
 */
function generateUserCode() {
    let code;
    do {
        code = `USR-${Math.floor(100000 + Math.random() * 900000)}`;
    } while (db.users.some((user) => user.code === code));

    return code;
}

/**
 * Devuelve la versión pública de un usuario sin contraseña.
 * @param {object} user Usuario almacenado.
 * @returns {object|null} Usuario público.
 */
function toPublicUser(user) {
    if (!user) {
        return null;
    }

    return {
        id: user.id,
        code: user.code,
        firstName: user.firstName,
        lastName: user.lastName,
        nickname: user.nickname,
        isOnline: socketsByUserId.has(user.id)
    };
}

/**
 * Envía datos JSON a un socket si se encuentra abierto.
 * @param {WebSocket} ws Cliente WebSocket.
 * @param {object} data Mensaje a enviar.
 */
function sendJson(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

/**
 * Envía un mensaje a todos los clientes conectados.
 * @param {object} data Mensaje JSON.
 * @param {WebSocket|null} excludeWs Cliente a excluir opcionalmente.
 */
function broadcast(data, excludeWs = null) {
    wss.clients.forEach((client) => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

/**
 * Obtiene usuarios activos sin duplicar pestañas del mismo usuario.
 * @returns {Array<object>} Lista de usuarios conectados.
 */
function getUserList() {
    return Array.from(socketsByUserId.keys())
        .map((userId) => toPublicUser(findUserById(userId)))
        .filter(Boolean);
}

/**
 * Busca usuario por ID.
 * @param {string} userId ID del usuario.
 * @returns {object|null} Usuario encontrado.
 */
function findUserById(userId) {
    return db.users.find((user) => user.id === userId) || null;
}

/**
 * Busca usuario por nickname.
 * @param {string} nickname Nickname ingresado.
 * @returns {object|null} Usuario encontrado.
 */
function findUserByNickname(nickname) {
    const target = normalizeNickname(nickname);
    return db.users.find((user) => normalizeNickname(user.nickname) === target) || null;
}

/**
 * Obtiene sockets activos de un usuario.
 * @param {string} userId ID del usuario.
 * @returns {Set<WebSocket>} Sockets activos.
 */
function getSocketsForUser(userId) {
    return socketsByUserId.get(userId) || new Set();
}

/**
 * Envía un mensaje a todos los dispositivos activos de un usuario.
 * @param {string} userId ID destinatario.
 * @param {object} data Mensaje JSON.
 * @param {WebSocket|null} excludeWs Socket opcional a excluir.
 */
function sendToUser(userId, data, excludeWs = null) {
    getSocketsForUser(userId).forEach((client) => {
        if (client !== excludeWs) {
            sendJson(client, data);
        }
    });
}

/**
 * Crea una sesión persistente para un usuario.
 * @param {string} userId ID del usuario.
 * @returns {string} Token de sesión.
 */
function createSession(userId) {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
    db.sessions.push({ token, userId, createdAt: new Date(now).toISOString(), expiresAt });
    saveDatabase();
    return token;
}

/**
 * Obtiene usuario por token de sesión vigente.
 * @param {string} token Token persistido en cliente.
 * @returns {object|null} Usuario autenticado.
 */
function findUserBySessionToken(token) {
    const cleanToken = sanitizeText(token, 200);
    const now = Date.now();
    const session = db.sessions.find((item) => item.token === cleanToken && new Date(item.expiresAt).getTime() > now);
    return session ? findUserById(session.userId) : null;
}

/**
 * Elimina un token de sesión.
 * @param {string} token Token a invalidar.
 */
function removeSession(token) {
    db.sessions = db.sessions.filter((session) => session.token !== token);
    saveDatabase();
}

/**
 * Asocia un WebSocket a una cuenta autenticada.
 * @param {WebSocket} ws Socket autenticado.
 * @param {object} user Usuario almacenado.
 * @param {string} sessionToken Token vigente.
 */
function attachAuthenticatedUser(ws, user, sessionToken) {
    detachSocket(ws, false);

    const wasOffline = !socketsByUserId.has(user.id);
    const publicUser = toPublicUser(user);
    users.set(ws, publicUser);

    if (!socketsByUserId.has(user.id)) {
        socketsByUserId.set(user.id, new Set());
    }
    socketsByUserId.get(user.id).add(ws);

    const authenticatedUser = toPublicUser(user);
    sendJson(ws, {
        type: 'auth_success',
        payload: {
            sessionToken,
            user: authenticatedUser
        },
        timestamp: new Date().toISOString()
    });

    sendInitialState(ws, authenticatedUser);

    if (wasOffline) {
        broadcast({
            type: 'system',
            payload: { text: `${user.nickname} se ha conectado 🟢` },
            timestamp: new Date().toISOString()
        });
        logEvent(`${user.nickname} conectado`);
    }

    broadcastUserList();
    broadcastGroupLists();
}

/**
 * Desasocia un socket y emite desconexión si era el último dispositivo del usuario.
 * @param {WebSocket} ws Socket a remover.
 * @param {boolean} notify Indica si debe notificar al resto.
 */
function detachSocket(ws, notify = true) {
    const user = users.get(ws);
    if (!user) {
        return;
    }

    users.delete(ws);
    const sockets = socketsByUserId.get(user.id);
    if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
            socketsByUserId.delete(user.id);
            if (notify) {
                broadcast({
                    type: 'system',
                    payload: { text: `${user.nickname} se ha desconectado 🔴` },
                    timestamp: new Date().toISOString()
                });
                broadcastUserList();
                broadcastGroupLists();
                logEvent(`${user.nickname} desconectado`);
            }
        }
    }
}

/**
 * Envía estado inicial al cliente después de autenticarse.
 * @param {WebSocket} ws Socket autenticado.
 * @param {object} publicUser Usuario público.
 */
function sendInitialState(ws, publicUser) {
    sendJson(ws, {
        type: 'history',
        payload: { messages: db.globalHistory },
        timestamp: new Date().toISOString()
    });

    sendJson(ws, {
        type: 'group_list',
        payload: { groups: getGroupsForUser(publicUser.id) },
        timestamp: new Date().toISOString()
    });

    sendJson(ws, {
        type: 'private_conversations',
        payload: { conversations: getPrivateConversationsForUser(publicUser.id) },
        timestamp: new Date().toISOString()
    });
}

/**
 * Emite la lista actualizada de usuarios a todos los clientes.
 */
function broadcastUserList() {
    broadcast({
        type: 'user_list',
        payload: { users: getUserList() },
        timestamp: new Date().toISOString()
    });
}

/**
 * Obtiene los grupos visibles para un usuario.
 * @param {string} userId ID público del usuario.
 * @returns {Array<object>} Lista de grupos visibles.
 */
function getGroupsForUser(userId) {
    return db.groups
        .filter((group) => Array.isArray(group.memberIds) && group.memberIds.includes(userId))
        .map((group) => ({
            id: group.id,
            name: group.name,
            createdBy: group.createdBy,
            createdAt: group.createdAt,
            members: group.memberIds.map((memberId) => toPublicUser(findUserById(memberId))).filter(Boolean),
            history: Array.isArray(group.history) ? group.history.slice(-MAX_HISTORY) : []
        }));
}

/**
 * Envía la lista de grupos actualizada a todos los usuarios conectados.
 */
function broadcastGroupLists() {
    users.forEach((user, client) => {
        sendJson(client, {
            type: 'group_list',
            payload: { groups: getGroupsForUser(user.id) },
            timestamp: new Date().toISOString()
        });
    });
}

/**
 * Obtiene conversaciones privadas persistidas para un usuario.
 * @param {string} userId ID del usuario.
 * @returns {Array<object>} Conversaciones privadas.
 */
function getPrivateConversationsForUser(userId) {
    const grouped = new Map();

    db.privateMessages
        .filter((message) => message.fromId === userId || message.toId === userId)
        .forEach((message) => {
            const otherId = message.fromId === userId ? message.toId : message.fromId;
            const otherUser = toPublicUser(findUserById(otherId));
            if (!otherUser) {
                return;
            }

            if (!grouped.has(otherId)) {
                grouped.set(otherId, {
                    user: otherUser,
                    messages: [],
                    updatedAt: message.timestamp
                });
            }

            grouped.get(otherId).messages.push({
                id: message.id,
                fromId: message.fromId,
                from: message.fromNickname,
                toId: message.toId,
                to: message.toNickname,
                text: message.text,
                timestamp: message.timestamp,
                kind: 'private',
                direction: message.fromId === userId ? 'out' : 'in'
            });
            grouped.get(otherId).updatedAt = message.timestamp;
        });

    return Array.from(grouped.values())
        .map((conversation) => ({
            ...conversation,
            messages: conversation.messages.slice(-MAX_HISTORY)
        }))
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/**
 * Guarda un mensaje global persistente, limitando a los últimos 50.
 * @param {object} message Mensaje global.
 */
function saveHistory(message) {
    db.globalHistory.push(message);
    db.globalHistory = db.globalHistory.slice(-MAX_HISTORY);
    saveDatabase();
}

/**
 * Valida datos de registro.
 * @param {object} payload Datos recibidos.
 * @returns {{valid:boolean,data:object,error:string}} Resultado.
 */
function validateRegisterPayload(payload) {
    const firstName = sanitizeText(payload.firstName, MAX_NAME_LENGTH);
    const lastName = sanitizeText(payload.lastName, MAX_NAME_LENGTH);
    const nickname = sanitizeText(payload.nickname, MAX_NICKNAME_LENGTH);
    const password = String(payload.password || '');

    if (!firstName || !lastName || !nickname) {
        return { valid: false, data: {}, error: 'Nombre, apellido y nickname son obligatorios.' };
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return { valid: false, data: {}, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    }

    if (findUserByNickname(nickname)) {
        return { valid: false, data: {}, error: 'Ese nickname ya está registrado. Usa otro o inicia sesión.' };
    }

    return { valid: true, data: { firstName, lastName, nickname, password }, error: '' };
}

/**
 * Registra una cuenta nueva y autentica el socket.
 * @param {WebSocket} ws Cliente solicitante.
 * @param {object} payload Datos de cuenta.
 */
function handleRegister(ws, payload) {
    const validation = validateRegisterPayload(payload);
    if (!validation.valid) {
        sendJson(ws, { type: 'auth_error', payload: { text: validation.error }, timestamp: new Date().toISOString() });
        return;
    }

    const { firstName, lastName, nickname, password } = validation.data;
    const { salt, hash } = hashPassword(password);
    const now = new Date().toISOString();
    const user = {
        id: randomUUID(),
        code: generateUserCode(),
        firstName,
        lastName,
        nickname,
        passwordSalt: salt,
        passwordHash: hash,
        createdAt: now,
        updatedAt: now
    };

    db.users.push(user);
    saveDatabase();

    const token = createSession(user.id);
    attachAuthenticatedUser(ws, user, token);
}

/**
 * Autentica una cuenta existente con nickname y contraseña.
 * @param {WebSocket} ws Cliente solicitante.
 * @param {object} payload Credenciales.
 */
function handleLogin(ws, payload) {
    const nickname = sanitizeText(payload.nickname, MAX_NICKNAME_LENGTH);
    const password = String(payload.password || '');
    const user = findUserByNickname(nickname);

    if (!user || !verifyPassword(password, user)) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'Nickname o contraseña incorrectos.' }, timestamp: new Date().toISOString() });
        return;
    }

    const token = createSession(user.id);
    attachAuthenticatedUser(ws, user, token);
}

/**
 * Reanuda una sesión mediante token guardado en localStorage.
 * @param {WebSocket} ws Cliente solicitante.
 * @param {object} payload Datos de sesión.
 */
function handleResume(ws, payload) {
    const sessionToken = sanitizeText(payload.sessionToken, 200);
    const user = findUserBySessionToken(sessionToken);

    if (!user) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'La sesión expiró. Inicia sesión nuevamente.' }, timestamp: new Date().toISOString() });
        return;
    }

    attachAuthenticatedUser(ws, user, sessionToken);
}

/**
 * Cierra sesión del token actual.
 * @param {WebSocket} ws Cliente solicitante.
 * @param {object} payload Datos de sesión.
 */
function handleLogout(ws, payload) {
    removeSession(payload.sessionToken);
    detachSocket(ws, true);
    sendJson(ws, { type: 'logout_success', payload: {}, timestamp: new Date().toISOString() });
}

/**
 * Procesa un mensaje global y lo reenvía a todos.
 * @param {WebSocket} ws Cliente emisor.
 * @param {{text:string}} payload Datos del mensaje.
 * @param {string} timestamp Fecha enviada por cliente.
 */
function handleMessage(ws, payload, timestamp) {
    const user = users.get(ws);
    const text = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);

    if (!user?.nickname || !text) {
        return;
    }

    const message = {
        id: randomUUID(),
        fromId: user.id,
        from: user.nickname,
        text,
        timestamp: timestamp || new Date().toISOString()
    };

    saveHistory(message);
    broadcast({
        type: 'broadcast',
        payload: message,
        timestamp: message.timestamp
    });
}

/**
 * Envía un mensaje privado a todos los dispositivos del destinatario y del emisor.
 * @param {WebSocket} ws Cliente emisor.
 * @param {{targetId:string,text:string}} payload Datos privados.
 * @param {string} timestamp Fecha enviada por cliente.
 */
function handlePrivate(ws, payload, timestamp) {
    const sender = users.get(ws);
    const targetUser = findUserById(payload.targetId);
    const text = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);

    if (!sender?.nickname || !payload.targetId || payload.targetId === sender.id || !targetUser || !text) {
        sendJson(ws, { type: 'private_error', payload: { text: 'Mensaje privado inválido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const message = {
        id: randomUUID(),
        fromId: sender.id,
        from: sender.nickname,
        toId: targetUser.id,
        to: targetUser.nickname,
        text,
        timestamp: timestamp || new Date().toISOString()
    };

    db.privateMessages.push({
        id: message.id,
        fromId: sender.id,
        fromNickname: sender.nickname,
        toId: targetUser.id,
        toNickname: targetUser.nickname,
        text,
        timestamp: message.timestamp
    });
    db.privateMessages = db.privateMessages.slice(-1000);
    saveDatabase();

    const payloadMessage = {
        type: 'private_msg',
        payload: message,
        timestamp: message.timestamp
    };

    sendToUser(targetUser.id, payloadMessage);
    sendToUser(sender.id, payloadMessage, ws);
}

/**
 * Crea un grupo/comunidad con miembros activos.
 * @param {WebSocket} ws Cliente creador.
 * @param {{name:string,memberIds:string[]}} payload Datos del grupo.
 */
function handleCreateGroup(ws, payload) {
    const creator = users.get(ws);
    const name = sanitizeText(payload.name, 40);
    const selectedMemberIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];

    if (!creator?.nickname || !name) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Nombre de grupo inválido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const activeIds = new Set(getUserList().map((user) => user.id));
    const memberIds = new Set([creator.id]);

    selectedMemberIds.forEach((memberId) => {
        if (activeIds.has(memberId) && memberId !== creator.id) {
            memberIds.add(memberId);
        }
    });

    if (memberIds.size < 2) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Selecciona al menos un participante activo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const group = {
        id: randomUUID(),
        name,
        createdBy: creator.id,
        createdAt: new Date().toISOString(),
        memberIds: Array.from(memberIds),
        history: []
    };

    db.groups.push(group);
    saveDatabase();
    broadcastGroupLists();
    logEvent(`${creator.nickname} creó el grupo ${name}`);
}

/**
 * Agrega nuevos miembros activos a un grupo existente.
 * @param {WebSocket} ws Cliente que solicita la acción.
 * @param {{groupId:string, memberIds:string[]}} payload Datos de solicitud.
 */
function handleAddGroupMembers(ws, payload) {
    const requester = users.get(ws);
    const group = db.groups.find((item) => item.id === payload.groupId);
    const selectedIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];

    if (!requester?.nickname || !group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Grupo no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (!group.memberIds.includes(requester.id)) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No eres miembro de este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const activeIds = new Set(getUserList().map((user) => user.id));
    let added = 0;

    selectedIds.forEach((id) => {
        if (activeIds.has(id) && !group.memberIds.includes(id)) {
            group.memberIds.push(id);
            added += 1;
        }
    });

    if (added === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No se agregaron nuevos miembros.' }, timestamp: new Date().toISOString() });
        return;
    }

    saveDatabase();
    broadcastGroupLists();
    logEvent(`${requester.nickname} agregó ${added} miembro(s) al grupo ${group.name}`);
}

/**
 * Genera un token de invitación para un grupo.
 * @param {WebSocket} ws Cliente que solicita.
 * @param {{groupId:string}} payload Datos.
 */
function handleGenerateInvite(ws, payload) {
    const requester = users.get(ws);
    const group = db.groups.find((item) => item.id === payload.groupId);

    if (!requester?.nickname || !group || !group.memberIds.includes(requester.id)) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No puedes generar una invitación para este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    inviteTokens.set(token, group.id);
    setTimeout(() => inviteTokens.delete(token), 24 * 60 * 60 * 1000);

    sendJson(ws, {
        type: 'invite_link',
        payload: { token, groupId: group.id, groupName: group.name },
        timestamp: new Date().toISOString()
    });
}

/**
 * Une a un usuario a un grupo mediante un token de invitación.
 * @param {WebSocket} ws Cliente que se une.
 * @param {{token:string}} payload Datos del token.
 */
function handleJoinByInvite(ws, payload) {
    const requester = users.get(ws);
    const groupId = inviteTokens.get(payload.token);

    if (!requester?.nickname || !groupId) {
        sendJson(ws, { type: 'group_error', payload: { text: 'El enlace de invitación no es válido o expiró.' }, timestamp: new Date().toISOString() });
        return;
    }

    const group = db.groups.find((item) => item.id === groupId);
    if (!group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'El grupo ya no existe.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (group.memberIds.includes(requester.id)) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Ya eres miembro de este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    group.memberIds.push(requester.id);
    saveDatabase();
    broadcastGroupLists();
    logEvent(`${requester.nickname} se unió a ${group.name} por invitación`);
}

/**
 * Envía un mensaje de grupo sólo a los miembros de la comunidad.
 * @param {WebSocket} ws Cliente emisor.
 * @param {{groupId:string,text:string}} payload Datos del mensaje.
 * @param {string} timestamp Fecha enviada por el cliente.
 */
function handleGroupMessage(ws, payload, timestamp) {
    const sender = users.get(ws);
    const group = db.groups.find((item) => item.id === payload.groupId);
    const text = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);

    if (!sender?.nickname || !group || !group.memberIds.includes(sender.id) || !text) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Mensaje de grupo inválido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const message = {
        id: randomUUID(),
        groupId: group.id,
        groupName: group.name,
        fromId: sender.id,
        from: sender.nickname,
        text,
        timestamp: timestamp || new Date().toISOString()
    };

    group.history.push(message);
    group.history = group.history.slice(-MAX_HISTORY);
    saveDatabase();

    group.memberIds.forEach((memberId) => {
        sendToUser(memberId, {
            type: 'group_msg',
            payload: message,
            timestamp: message.timestamp
        });
    });

    broadcastGroupLists();
}

/**
 * Reenvía el indicador de escritura a todos menos al socket emisor.
 * @param {WebSocket} ws Cliente emisor.
 * @param {{isTyping:boolean}} payload Estado de escritura.
 */
function handleTyping(ws, payload) {
    const user = users.get(ws);

    if (!user?.nickname) {
        return;
    }

    broadcast({
        type: 'typing_status',
        payload: {
            fromId: user.id,
            nickname: user.nickname,
            isTyping: Boolean(payload.isTyping)
        },
        timestamp: new Date().toISOString()
    }, ws);
}

/**
 * Enruta mensajes JSON del cliente según el campo type.
 * @param {WebSocket} ws Cliente emisor.
 * @param {Buffer} rawMessage Mensaje recibido.
 */
function handleSocketMessage(ws, rawMessage) {
    let data;

    try {
        data = JSON.parse(rawMessage.toString());
    } catch (error) {
        sendJson(ws, { type: 'error', payload: { text: 'El mensaje debe ser JSON válido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const { type, payload = {}, timestamp } = data;

    switch (type) {
        case 'register':
            handleRegister(ws, payload);
            break;
        case 'login':
            handleLogin(ws, payload);
            break;
        case 'resume':
            handleResume(ws, payload);
            break;
        case 'logout':
            handleLogout(ws, payload);
            break;
        case 'message':
            handleMessage(ws, payload, timestamp);
            break;
        case 'private':
            handlePrivate(ws, payload, timestamp);
            break;
        case 'typing':
            handleTyping(ws, payload);
            break;
        case 'create_group':
            handleCreateGroup(ws, payload);
            break;
        case 'group_message':
            handleGroupMessage(ws, payload, timestamp);
            break;
        case 'add_group_members':
            handleAddGroupMembers(ws, payload);
            break;
        case 'join_by_invite':
            handleJoinByInvite(ws, payload);
            break;
        case 'generate_invite':
            handleGenerateInvite(ws, payload);
            break;
        default:
            sendJson(ws, { type: 'error', payload: { text: 'Tipo de mensaje no reconocido.' }, timestamp: new Date().toISOString() });
    }
}

wss.on('connection', (ws) => {
    logEvent('Cliente WebSocket conectado');

    ws.on('message', (message) => handleSocketMessage(ws, message));
    ws.on('close', () => detachSocket(ws, true));
});

server.listen(PORT, () => {
    logEvent(`Servidor en http://localhost:${PORT}`);
});
