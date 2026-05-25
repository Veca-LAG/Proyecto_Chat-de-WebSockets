import { sendPrivate } from './modules/private.js';
import { setupTypingEvents, handleTypingStatus, clearTypingIndicator } from './modules/typing.js';
import { initEmojiPicker } from './emoji/picker.js';
import { initNotify, playNotify } from './sounds/notify.js';  
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 5000;
const MAX_NICKNAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 300;
const MAX_GROUP_NAME_LENGTH = 40;

const SECTION_CONFIG = {
    global: {
        title: 'Foro Global',
        subtitle: 'Canal abierto para todos los usuarios conectados.',
        avatar: '🌐'
    },
    private: {
        title: 'Privados',
        subtitle: '',
        avatar: '✉️'
    },
    communities: {
        title: 'Comunidades',
        subtitle: '',
        avatar: '👥'
    }
};

const state = {
    socket: null,
    nickname: '',
    selfId: null,
    users: [],
    groups: [],
    globalMessages: [],
    privateConversations: {},
    activeSection: 'global',
    activeChat: null,
    reconnectAttempts: 0,
    shouldReconnect: false
};

const elements = {
    loginModal: document.getElementById('loginModal'),
    loginForm: document.getElementById('loginForm'),
    nicknameInput: document.getElementById('nicknameInput'),
    loginError: document.getElementById('loginError'),
    connectionStatus: document.getElementById('connectionStatus'),
    chatTitle: document.getElementById('chatTitle'),
    chatSubtitle: document.getElementById('chatSubtitle'),
    chatAvatar: document.getElementById('chatAvatar'),
    messages: document.getElementById('messages'),
    messageForm: document.getElementById('messageForm'),
    messageInput: document.getElementById('messageInput'),
    sendButton: document.getElementById('sendButton'),
    chatList: document.getElementById('chatList'),
    userSearchInput: document.getElementById('userSearchInput'),
    themeToggle: document.getElementById('themeToggle'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    userSidebar: document.getElementById('userSidebar'),
    emojiButton: document.getElementById('emojiButton'),
    emojiPicker: document.getElementById('emojiPicker'),
    selfNickname: document.getElementById('selfNickname'),
    selfAvatar: document.getElementById('selfAvatar'),
    profileAvatar: document.getElementById('profileAvatar'),
    profileName: document.getElementById('profileName'),
    profileStatus: document.getElementById('profileStatus'),
    profileDescription: document.getElementById('profileDescription'),
    profileExtra: document.getElementById('profileExtra'),
    navGlobal: document.getElementById('navGlobal'),
    navPrivate: document.getElementById('navPrivate'),
    navCommunities: document.getElementById('navCommunities'),
    listMenuButton: document.getElementById('listMenuButton'),
    listMenu: document.getElementById('listMenu'),
    openGroupModalButton: document.getElementById('openGroupModalButton'),
    groupModal: document.getElementById('groupModal'),
    groupForm: document.getElementById('groupForm'),
    groupNameInput: document.getElementById('groupNameInput'),
    participantsList: document.getElementById('participantsList'),
    groupError: document.getElementById('groupError'),
    closeGroupModalButton: document.getElementById('closeGroupModalButton'),
    cancelGroupButton: document.getElementById('cancelGroupButton'),
    conversationSearchButton: document.getElementById('conversationSearchButton'),
    conversationSearchBar: document.getElementById('conversationSearchBar'),
    conversationSearchInput: document.getElementById('conversationSearchInput'),
    closeConversationSearch: document.getElementById('closeConversationSearch'),
    chatMenuButton: document.getElementById('chatMenuButton'),
    chatMenu: document.getElementById('chatMenu'),
    deleteConversationButton: document.getElementById('deleteConversationButton')
};

/**
 * Sanitiza una cadena de texto eliminando etiquetas HTML y aplicando longitud máxima.
 * @param {string} value Texto original.
 * @param {number} maxLength Longitud máxima.
 * @returns {string} Texto seguro.
 */
function sanitizeInput(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>?/gm, '')
        .trim()
        .slice(0, maxLength);
}

/**
 * Obtiene iniciales para avatares textuales.
 * @param {string} value Nombre o título.
 * @returns {string} Iniciales del nombre.
 */
function getInitials(value) {
    return String(value || 'U')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'U';
}

/**
 * Genera un identificador estable basado en nickname para historial local de privados.
 * @param {string} nickname Nombre de usuario.
 * @returns {string} Llave normalizada.
 */
function getPrivateKey(nickname) {
    return sanitizeInput(nickname, 80).toLowerCase();
}

/**
 * Obtiene la llave de localStorage del usuario actual.
 * @returns {string} Llave de almacenamiento.
 */
function getStorageKey() {
    return `chat-socket:${state.nickname || 'anonymous'}:frontend-v3`;
}

/**
 * Carga conversaciones privadas previas desde localStorage.
 */
function loadLocalState() {
    try {
        const raw = localStorage.getItem(getStorageKey());
        const parsed = raw ? JSON.parse(raw) : {};
        state.privateConversations = parsed.privateConversations || {};
    } catch (error) {
        state.privateConversations = {};
    }
}

/**
 * Guarda el estado local del cliente.
 */
function saveLocalState() {
    const data = {
        privateConversations: state.privateConversations
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(data));
}

/**
 * Construye la URL correcta para WebSocket según el protocolo actual.
 * @returns {string} URL ws:// o wss://.
 */
function getWebSocketUrl() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}`;
}

/**
 * Envía un objeto JSON por WebSocket si la conexión está abierta.
 * @param {object} data Mensaje con type, payload y timestamp.
 * @returns {boolean} True si se envió correctamente.
 */
function sendJson(data) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    state.socket.send(JSON.stringify(data));
    return true;
}

/**
 * Actualiza el estado visual de conexión y habilita input sólo si hay chat seleccionado.
 * @param {'connected'|'connecting'|'disconnected'} status Estado del socket.
 */
function updateConnectionStatus(status) {
    const labels = {
        connected: 'Conectado',
        connecting: 'Conectando...',
        disconnected: 'Desconectado'
    };

    elements.connectionStatus.textContent = labels[status];
    elements.connectionStatus.className = `connection-status ${status}`;
    updateComposerState();
}

/**
 * Habilita o deshabilita el campo de mensaje según la conversación activa.
 */
function updateComposerState() {
    const isConnected = state.socket?.readyState === WebSocket.OPEN;
    const canSend = isConnected && Boolean(state.activeChat) && canSendToActiveChat();

    elements.messageInput.disabled = !canSend;
    elements.sendButton.disabled = !canSend;

    if (!state.activeChat) {
        elements.messageInput.placeholder = 'Selecciona una conversación';
        return;
    }

    if (!canSend) {
        elements.messageInput.placeholder = 'No se puede enviar en esta conversación';
        return;
    }

    elements.messageInput.placeholder = 'Escribir mensaje';
}

/**
 * Indica si el chat activo permite enviar mensajes.
 * @returns {boolean} True si el usuario puede enviar.
 */
function canSendToActiveChat() {
    if (!state.activeChat) {
        return false;
    }

    if (state.activeChat.type === 'private') {
        return Boolean(getActiveUserByNickname(state.activeChat.name));
    }

    return true;
}

/**
 * Actualiza la identidad visible del usuario actual.
 */
function updateSelfIdentity() {
    elements.selfNickname.textContent = state.nickname || 'Sin conectar';
    elements.selfAvatar.textContent = state.nickname ? getInitials(state.nickname) : 'Tú';
}

/**
 * Abre la conexión WebSocket después de validar el nickname.
 */
function connectWebSocket() {
    updateConnectionStatus('connecting');
    state.socket = new WebSocket(getWebSocketUrl());

    state.socket.addEventListener('open', () => {
        state.reconnectAttempts = 0;
        state.shouldReconnect = true;
        updateConnectionStatus('connected');
        elements.loginModal.classList.add('hidden');
        sendJson({
            type: 'join',
            payload: { nickname: state.nickname },
            timestamp: new Date().toISOString()
        });
    });

    state.socket.addEventListener('message', (event) => {
        handleServerMessage(event.data);
    });

    state.socket.addEventListener('close', () => {
        updateConnectionStatus('disconnected');
        if (state.shouldReconnect) {
            scheduleReconnect();
        }
    });

    state.socket.addEventListener('error', () => {
        updateConnectionStatus('disconnected');
    });
}

/**
 * Programa reconexión automática con espera progresiva.
 */
function scheduleReconnect() {
    state.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_BASE_DELAY * state.reconnectAttempts, RECONNECT_MAX_DELAY);

    window.setTimeout(() => {
        if (state.nickname && (!state.socket || state.socket.readyState === WebSocket.CLOSED)) {
            connectWebSocket();
        }
    }, delay);
}

/**
 * Procesa mensajes recibidos desde el servidor.
 * @param {string} rawMessage Mensaje JSON como texto.
 */
function handleServerMessage(rawMessage) {
    let data;

    try {
        data = JSON.parse(rawMessage);
    } catch (error) {
        return;
    }

    const { type, payload = {}, timestamp } = data;

    switch (type) {
        case 'invite_link':
            showInviteLink(payload);
            break;
        case 'join_success':
            state.selfId = payload.id;
            updateSelfIdentity();
            renderChatList();
            updateComposerState();
            checkInviteToken();
            break;
        case 'history':
            state.globalMessages = payload.messages || [];
            if (state.activeChat?.type === 'global') {
                renderActiveChatMessages();
            }
            break;
        case 'user_list':
            state.users = payload.users || [];
            renderChatList();
            updateComposerState();
            break;
        case 'group_list':
            state.groups = payload.groups || [];
            renderChatList();
            if (state.activeChat?.type === 'group') {
                syncActiveGroup();
            }
            break;
        case 'broadcast':
            state.globalMessages.push({ ...payload, timestamp });
            if (state.activeChat?.type === 'global') {
                renderMessage({ ...payload, timestamp, kind: 'global' });
            }
            if (payload.fromId !== state.selfId) playNotify();

            break;
        case 'private_msg':
            receivePrivateMessage(payload, timestamp);
            playNotify();
            break;
        case 'group_msg':
            receiveGroupMessage(payload, timestamp);
            break;
        case 'private_error':
        case 'group_error':
        case 'error':
            renderSystemMessage(payload.text || 'Ocurrió un error.', timestamp);
            break;
        case 'typing_status':
            if (state.activeChat?.type === 'global' || state.activeChat?.type === 'private') {
                handleTypingStatus(elements.typingIndicator, payload, state.selfId);
            }
            break;
        case 'system':
            if (state.activeChat?.type === 'global') {
                renderSystemMessage(payload.text || 'Evento del sistema', timestamp);
            }
            break;
        default:
            break;
    }
}

/**
 * Cambia la sección activa del panel izquierdo.
 * @param {'global'|'private'|'communities'} section Sección destino.
 * @param {boolean} openDefault Indica si debe abrir automáticamente el chat principal de la sección.
 */
function setActiveSection(section, openDefault = true) {
    state.activeSection = section;

    if (section === 'global' && openDefault) {
        state.activeChat = { type: 'global', id: 'global', name: 'Foro Global' };
    } else {
        state.activeChat = null;
    }

    closeMenus();
    clearConversationSearch();
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
}

/**
 * Marca visualmente el botón de navegación activo.
 */
function renderNavigation() {
    const navButtons = [elements.navGlobal, elements.navPrivate, elements.navCommunities];

    navButtons.forEach((button) => {
        const isActive = button.dataset.section === state.activeSection;
        button.classList.toggle('rail-item-active', isActive);
    });
}

/**
 * Filtra elementos por el texto del buscador de lista.
 * @param {Array<object>} items Lista original.
 * @param {(item:object)=>string} getText Función que obtiene texto.
 * @returns {Array<object>} Lista filtrada.
 */
function filterList(items, getText) {
    const term = sanitizeInput(elements.userSearchInput.value, 60).toLowerCase();
    if (!term) {
        return items;
    }

    return items.filter((item) => getText(item).toLowerCase().includes(term));
}

/**
 * Renderiza la lista del panel central-izquierdo según la sección activa.
 */
function renderChatList() {
    elements.chatList.innerHTML = '';

    if (state.activeSection === 'global') {
        renderGlobalUserList();
        return;
    }

    if (state.activeSection === 'private') {
        renderPrivateConversationList();
        return;
    }

    renderCommunityList();
}

/**
 * Renderiza usuarios conectados en la sección Foro Global.
 */
function renderGlobalUserList() {
    const users = filterList(state.users, (user) => user.nickname);

    users.forEach((user) => {
        const isSelf = user.id === state.selfId;
        const item = createListItem({
            avatar: getInitials(user.nickname),
            title: `${user.nickname}${isSelf ? ' (Tú)' : ''}`,
            subtitle: isSelf ? 'Tu sesión activa' : 'En línea · clic para privado',
            active: state.activeChat?.type === 'private' && state.activeChat?.name === user.nickname,
            disabled: isSelf,
            onClick: () => selectPrivateByUser(user)
        });
        elements.chatList.appendChild(item);
    });
}

/**
 * Renderiza conversaciones privadas previas del usuario.
 */
function renderPrivateConversationList() {
    const conversations = Object.values(state.privateConversations)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const filtered = filterList(conversations, (conversation) => conversation.nickname);

    filtered.forEach((conversation) => {
        const lastMessage = conversation.messages?.at(-1)?.text || '';
        const activeUser = getActiveUserByNickname(conversation.nickname);
        const item = createListItem({
            avatar: getInitials(conversation.nickname),
            title: conversation.nickname,
            subtitle: lastMessage || (activeUser ? 'En línea' : 'Sin mensajes recientes'),
            active: state.activeChat?.type === 'private' && state.activeChat?.name === conversation.nickname,
            onClick: () => selectPrivateConversation(conversation.nickname)
        });
        elements.chatList.appendChild(item);
    });
}

/**
 * Renderiza comunidades o grupos creados.
 */
function renderCommunityList() {
    const groups = filterList(state.groups, (group) => group.name);

    groups.forEach((group) => {
        const lastMessage = group.history?.at(-1)?.text || `${group.members?.length || 0} miembros`;
        const item = createListItem({
            avatar: '#',
            title: group.name,
            subtitle: lastMessage,
            active: state.activeChat?.type === 'group' && state.activeChat?.id === group.id,
            onClick: () => selectGroup(group)
        });
        elements.chatList.appendChild(item);
    });
}

/**
 * Crea un ítem reutilizable para usuarios, privados o comunidades.
 * @param {object} options Configuración del ítem.
 * @returns {HTMLLIElement} Elemento de lista.
 */
function createListItem({ avatar, title, subtitle, active = false, disabled = false, onClick }) {
    const listItem = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ['chat-list-item', active ? 'chat-list-item-active' : ''].filter(Boolean).join(' ');
    button.disabled = Boolean(disabled);

    const avatarElement = document.createElement('span');
    avatarElement.className = 'chat-list-avatar';
    avatarElement.textContent = avatar;

    const textWrapper = document.createElement('span');
    textWrapper.className = 'chat-list-text';

    const titleElement = document.createElement('strong');
    titleElement.textContent = title;

    const subtitleElement = document.createElement('small');
    subtitleElement.textContent = subtitle || '';

    textWrapper.append(titleElement, subtitleElement);
    button.append(avatarElement, textWrapper);

    if (!disabled && typeof onClick === 'function') {
        button.addEventListener('click', onClick);
    }

    listItem.appendChild(button);
    return listItem;
}

/**
 * Selecciona el Foro Global como conversación activa.
 */
function selectGlobalChat() {
    state.activeSection = 'global';
    state.activeChat = { type: 'global', id: 'global', name: 'Foro Global' };
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
}

/**
 * Selecciona usuario activo para iniciar chat privado.
 * @param {{id:string,nickname:string}} user Usuario destino.
 */
function selectPrivateByUser(user) {
    ensurePrivateConversation(user.nickname);
    state.activeSection = 'private';
    state.activeChat = { type: 'private', id: user.id, name: user.nickname };
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
    elements.userSidebar.classList.remove('is-open');
    elements.messageInput.focus();
}

/**
 * Selecciona una conversación privada existente.
 * @param {string} nickname Nickname del contacto.
 */
function selectPrivateConversation(nickname) {
    const activeUser = getActiveUserByNickname(nickname);
    state.activeChat = {
        type: 'private',
        id: activeUser?.id || null,
        name: nickname
    };
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
    elements.messageInput.focus();
}

/**
 * Selecciona un grupo/comunidad existente.
 * @param {{id:string,name:string}} group Grupo seleccionado.
 */
function selectGroup(group) {
    state.activeChat = { type: 'group', id: group.id, name: group.name };
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
    elements.messageInput.focus();
}

/**
 * Busca un usuario activo por nickname.
 * @param {string} nickname Nickname.
 * @returns {{id:string,nickname:string}|undefined} Usuario encontrado.
 */
function getActiveUserByNickname(nickname) {
    return state.users.find((user) => user.nickname.toLowerCase() === String(nickname || '').toLowerCase());
}

/**
 * Garantiza que exista una conversación privada local.
 * @param {string} nickname Nickname de contacto.
 * @returns {object} Conversación.
 */
function ensurePrivateConversation(nickname) {
    const key = getPrivateKey(nickname);
    if (!state.privateConversations[key]) {
        state.privateConversations[key] = {
            nickname,
            messages: [],
            updatedAt: new Date().toISOString()
        };
    }

    return state.privateConversations[key];
}

/**
 * Actualiza encabezado y panel derecho para la conversación activa.
 */
function renderActiveChatShell() {
    if (!state.activeChat) {
        const config = SECTION_CONFIG[state.activeSection];
        elements.chatAvatar.textContent = config.avatar;
        elements.chatTitle.textContent = state.activeSection === 'global' ? 'Selecciona Foro Global' : 'Selecciona una conversación';
        elements.chatSubtitle.textContent = '';
        elements.profileAvatar.textContent = config.avatar;
        elements.profileName.textContent = 'Sin conversación';
        elements.profileStatus.textContent = 'Selecciona un chat';
        elements.profileDescription.textContent = '';
        elements.profileExtra.innerHTML = '';
        return;
    }

    if (state.activeChat.type === 'global') {
        elements.chatAvatar.textContent = '🌐';
        elements.chatTitle.textContent = 'Foro Global';
        elements.chatSubtitle.textContent = 'Todos los usuarios conectados pueden leer y enviar mensajes.';
        elements.profileAvatar.textContent = '🌐';
        elements.profileName.textContent = 'Foro Global';
        elements.profileStatus.textContent = `● ${state.users.length} usuario(s) activo(s)`;
        elements.profileDescription.textContent = 'Canal público en tiempo real. El historial del servidor conserva los últimos 50 mensajes globales.';
        renderProfileUsers();
        return;
    }

    if (state.activeChat.type === 'private') {
        const activeUser = getActiveUserByNickname(state.activeChat.name);
        elements.chatAvatar.textContent = getInitials(state.activeChat.name);
        elements.chatTitle.textContent = state.activeChat.name;
        elements.chatSubtitle.textContent = activeUser ? 'Chat privado · usuario en línea' : 'Chat privado · usuario desconectado';
        elements.profileAvatar.textContent = getInitials(state.activeChat.name);
        elements.profileName.textContent = state.activeChat.name;
        elements.profileStatus.textContent = activeUser ? '● En línea' : '○ Desconectado';
        elements.profileDescription.textContent = 'Los mensajes privados solo se muestran para el emisor y el destinatario.';
        elements.profileExtra.innerHTML = '';
        return;
    }

    const group = state.groups.find((item) => item.id === state.activeChat.id);
    elements.chatAvatar.textContent = '#';
    elements.chatTitle.textContent = state.activeChat.name;
    elements.chatSubtitle.textContent = `${group?.members?.length || 0} miembro(s) en la comunidad`;
    elements.profileAvatar.textContent = '#';
    elements.profileName.textContent = state.activeChat.name;
    elements.profileStatus.textContent = 'Comunidad privada';
    elements.profileDescription.textContent = 'Los mensajes enviados aquí solo son visibles para miembros del grupo.';
    renderProfileGroupMembers(group);
}

/**
 * Renderiza usuarios activos en el panel derecho del Foro Global.
 */
function renderProfileUsers() {
    elements.profileExtra.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Activos ahora';
    const list = document.createElement('ul');

    state.users.forEach((user) => {
        const item = document.createElement('li');
        item.textContent = `● ${user.nickname}${user.id === state.selfId ? ' (Tú)' : ''}`;
        list.appendChild(item);
    });

    elements.profileExtra.append(title, list);
}

/**
 * Renderiza miembros de un grupo en el panel derecho.
 * @param {object|undefined} group Grupo seleccionado.
 */
function renderProfileGroupMembers(group) {
    elements.profileExtra.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Miembros';
    const list = document.createElement('ul');

    (group?.members || []).forEach((member) => {
        const item = document.createElement('li');
        item.textContent = `${member.nickname}${member.id === state.selfId ? ' (Tú)' : ''}`;
        list.appendChild(item);
    });

    const actions = document.createElement('div');
    actions.className = 'group-action-buttons';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'secondary-button';
    addBtn.textContent = '➕ Agregar miembros';
    addBtn.addEventListener('click', () => openAddMembersModal(group));

    const inviteBtn = document.createElement('button');
    inviteBtn.type = 'button';
    inviteBtn.className = 'secondary-button';
    inviteBtn.textContent = '🔗 Enlace de invitación';
    inviteBtn.addEventListener('click', () => requestInviteLink(group));

    actions.append(addBtn, inviteBtn);
    elements.profileExtra.append(title, list, actions);
}

/**
 * Renderiza mensajes de la conversación activa. Si no hay chat, queda vacío.
 */
function renderActiveChatMessages() {
    elements.messages.innerHTML = '';

    if (!state.activeChat) {
        return;
    }

    if (state.activeChat.type === 'global') {
        state.globalMessages.forEach((message) => renderMessage({ ...message, kind: 'global' }));
        return;
    }

    if (state.activeChat.type === 'private') {
        const conversation = ensurePrivateConversation(state.activeChat.name);
        conversation.messages.forEach((message) => renderMessage(message));
        return;
    }

    const group = state.groups.find((item) => item.id === state.activeChat.id);
    (group?.history || []).forEach((message) => renderMessage({ ...message, kind: 'group' }));
}

/**
 * Renderiza un mensaje del chat en el panel principal.
 * @param {{from?:string,fromId?:string,to?:string,text:string,timestamp?:string,kind?:string,direction?:string,historical?:boolean}} message Mensaje.
 */
function renderMessage(message) {
    const messageElement = document.createElement('article');
    const isOwn = message.fromId && message.fromId === state.selfId;
    const messageKind = message.kind || 'global';

    messageElement.className = [
        'message',
        isOwn ? 'message-own' : 'message-other',
        messageKind === 'private' ? 'message-private' : '',
        messageKind === 'group' ? 'message-group' : '',
        message.historical ? 'message-historical' : ''
    ].filter(Boolean).join(' ');

    const metaElement = document.createElement('div');
    metaElement.className = 'message-meta';

    const authorElement = document.createElement('strong');
    authorElement.textContent = getMessageAuthorLabel(message, isOwn);

    if (messageKind === 'private') {
        const badge = document.createElement('span');
        badge.className = 'message-private-badge';
        badge.textContent = '🔒';
        badge.title = 'Mensaje privado';
        metaElement.appendChild(badge);
    }

    const timeElement = document.createElement('time');
    timeElement.dateTime = message.timestamp || new Date().toISOString();
    timeElement.textContent = formatTime(message.timestamp);

    const textElement = document.createElement('p');
    textElement.className = 'message-content';
    textElement.dataset.rawText = message.text || '';
    textElement.textContent = message.text || '';

    metaElement.append(authorElement, timeElement);
    messageElement.append(metaElement, textElement);
    elements.messages.appendChild(messageElement);
    applyConversationSearch();
    scrollToLastMessage();
}

/**
 * Obtiene etiqueta del autor según tipo de mensaje.
 * @param {object} message Mensaje a mostrar.
 * @param {boolean} isOwn Indica si es del usuario actual.
 * @returns {string} Autor visible.
 */
function getMessageAuthorLabel(message, isOwn) {
    if (isOwn) {
        return 'Tú';
    }

    return message.from || 'Usuario';
}

/**
 * Renderiza un evento del sistema dentro del chat activo.
 * @param {string} text Texto del evento.
 * @param {string} [timestamp] Fecha opcional.
 */
function renderSystemMessage(text, timestamp = new Date().toISOString()) {
    if (!state.activeChat) {
        return;
    }

    const systemElement = document.createElement('p');
    systemElement.className = 'system-message';
    const systemText = `${formatTime(timestamp)} · ${text}`;
    systemElement.dataset.rawText = systemText;
    systemElement.textContent = systemText;
    elements.messages.appendChild(systemElement);
    applyConversationSearch();
    scrollToLastMessage();
}

/**
 * Convierte fecha ISO a HH:MM.
 * @param {string} [timestamp] Fecha ISO.
 * @returns {string} Hora formateada.
 */
function formatTime(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    return new Intl.DateTimeFormat('es-MX', {
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

/**
 * Desplaza el scroll al último mensaje.
 */
function scrollToLastMessage() {
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

/**
 * Procesa mensaje privado recibido y lo guarda en historial local.
 * @param {object} payload Datos recibidos.
 * @param {string} timestamp Fecha del servidor.
 */
function receivePrivateMessage(payload, timestamp) {
    const conversation = ensurePrivateConversation(payload.from);
    const message = {
        from: payload.from,
        fromId: payload.fromId,
        text: payload.text,
        timestamp,
        kind: 'private',
        direction: 'in'
    };

    conversation.messages.push(message);
    conversation.updatedAt = timestamp || new Date().toISOString();
    saveLocalState();
    renderChatList();

    if (state.activeChat?.type === 'private' && state.activeChat.name === payload.from) {
        renderMessage(message);
    }
}

/**
 * Procesa mensaje de grupo recibido del servidor.
 * @param {object} payload Datos del grupo.
 * @param {string} timestamp Fecha del servidor.
 */
function receiveGroupMessage(payload, timestamp) {
    const group = state.groups.find((item) => item.id === payload.groupId);
    const message = {
        groupId: payload.groupId,
        from: payload.from,
        fromId: payload.fromId,
        text: payload.text,
        timestamp,
        kind: 'group'
    };

    if (group) {
        group.history = [...(group.history || []), message].slice(-50);
    }

    renderChatList();

    if (state.activeChat?.type === 'group' && state.activeChat.id === payload.groupId) {
        renderMessage(message);
    }
}

/**
 * Sincroniza grupo activo si la lista recibida cambió.
 */
function syncActiveGroup() {
    const group = state.groups.find((item) => item.id === state.activeChat.id);
    if (!group) {
        state.activeChat = null;
        renderActiveChatShell();
        renderActiveChatMessages();
        updateComposerState();
        return;
    }

    state.activeChat.name = group.name;
    renderActiveChatShell();
    renderActiveChatMessages();
}

/**
 * Envía el mensaje actual según el tipo de conversación activa.
 * @param {SubmitEvent} event Evento submit.
 */
function handleMessageSubmit(event) {
    event.preventDefault();

    const text = sanitizeInput(elements.messageInput.value, MAX_MESSAGE_LENGTH);
    if (!text || !state.activeChat) {
        return;
    }

    const timestamp = new Date().toISOString();

    if (state.activeChat.type === 'global') {
        sendJson({
            type: 'message',
            payload: { text },
            timestamp
        });
    }

    if (state.activeChat.type === 'private') {
        const activeUser = getActiveUserByNickname(state.activeChat.name);
        if (!activeUser) {
            return;
        }

        const sent = sendPrivate({
            socketSender: sendJson,
            targetUser: activeUser,
            text,
            timestamp
        });

        if (sent) {
            const conversation = ensurePrivateConversation(activeUser.nickname);
            const message = {
                from: state.nickname,
                fromId: state.selfId,
                to: activeUser.nickname,
                text,
                timestamp,
                kind: 'private',
                direction: 'out'
            };
            conversation.messages.push(message);
            conversation.updatedAt = timestamp;
            saveLocalState();
            renderChatList();
            renderMessage(message);
        }
    }

    if (state.activeChat.type === 'group') {
        sendJson({
            type: 'group_message',
            payload: {
                groupId: state.activeChat.id,
                text
            },
            timestamp
        });
    }

    elements.messageInput.value = '';
    clearTypingIndicator(elements.typingIndicator);
    sendJson({ type: 'typing', payload: { isTyping: false }, timestamp: new Date().toISOString() });
}

/**
 * Valida nickname e inicia sesión WebSocket.
 * @param {SubmitEvent} event Evento submit.
 */
function handleLoginSubmit(event) {
    event.preventDefault();

    const nickname = sanitizeInput(elements.nicknameInput.value, MAX_NICKNAME_LENGTH);
    if (!nickname) {
        elements.loginError.textContent = 'El nickname no puede estar vacío.';
        return;
    }

    elements.loginError.textContent = '';
    state.nickname = nickname;
    loadLocalState();
    updateSelfIdentity();
    renderChatList();
    initNotify(); 
    connectWebSocket();
}

/**
 * Muestra u oculta el menú de lista.
 */
function toggleListMenu() {
    const isHidden = elements.listMenu.classList.toggle('hidden');
    elements.listMenuButton.setAttribute('aria-expanded', String(!isHidden));
}

/**
 * Muestra u oculta el menú de conversación.
 */
function toggleChatMenu() {
    const isHidden = elements.chatMenu.classList.toggle('hidden');
    elements.chatMenuButton.setAttribute('aria-expanded', String(!isHidden));
}

/**
 * Cierra menús flotantes.
 */
function closeMenus() {
    elements.listMenu.classList.add('hidden');
    elements.chatMenu.classList.add('hidden');
    elements.listMenuButton.setAttribute('aria-expanded', 'false');
    elements.chatMenuButton.setAttribute('aria-expanded', 'false');
}

/**
 * Abre el modal de creación de grupo y renderiza participantes activos.
 */
function openGroupModal() {
    closeMenus();
    elements.groupError.textContent = '';
    elements.groupNameInput.value = '';
    renderParticipantsList();
    elements.groupModal.classList.remove('hidden');
    elements.groupNameInput.focus();
}

/**
 * Cierra el modal de creación de grupo.
 */
function closeGroupModal() {
    elements.groupModal.classList.add('hidden');
}

/**
 * Renderiza usuarios activos seleccionables para un nuevo grupo.
 */
function renderParticipantsList() {
    elements.participantsList.innerHTML = '';
    const participants = state.users.filter((user) => user.id !== state.selfId);

    if (!participants.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-list-text';
        empty.textContent = 'No hay otros usuarios activos para agregar.';
        elements.participantsList.appendChild(empty);
        return;
    }

    participants.forEach((user) => {
        const label = document.createElement('label');
        label.className = 'participant-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = user.id;

        const avatar = document.createElement('span');
        avatar.className = 'chat-list-avatar';
        avatar.textContent = getInitials(user.nickname);

        const name = document.createElement('span');
        name.textContent = user.nickname;

        label.append(checkbox, avatar, name);
        elements.participantsList.appendChild(label);
    });
}

/**
 * Envía solicitud para crear grupo al servidor.
 * @param {SubmitEvent} event Evento submit.
 */
function handleGroupSubmit(event) {
    event.preventDefault();

    const name = sanitizeInput(elements.groupNameInput.value, MAX_GROUP_NAME_LENGTH);
    const memberIds = Array.from(elements.participantsList.querySelectorAll('input[type="checkbox"]:checked'))
        .map((input) => input.value);

    if (!name) {
        elements.groupError.textContent = 'El grupo necesita un nombre.';
        return;
    }

    if (!memberIds.length) {
        elements.groupError.textContent = 'Selecciona al menos un participante activo.';
        return;
    }

    const sent = sendJson({
        type: 'create_group',
        payload: { name, memberIds },
        timestamp: new Date().toISOString()
    });

    if (sent) {
        closeGroupModal();
        setActiveSection('communities', false);
    }
}

/**
 * Activa o cierra la búsqueda dentro de conversación.
 */
function toggleConversationSearch() {
    const isHidden = elements.conversationSearchBar.classList.toggle('hidden');
    if (!isHidden) {
        elements.conversationSearchInput.focus();
    } else {
        clearConversationSearch();
    }
}

/**
 * Limpia la búsqueda dentro de la conversación.
 */
function clearConversationSearch() {
    elements.conversationSearchInput.value = '';
    elements.conversationSearchBar.classList.add('hidden');
    applyConversationSearch();
}

/**
 * Resalta coincidencias de la búsqueda en mensajes visibles.
 */
function applyConversationSearch() {
    const term = elements.conversationSearchInput.value.trim();
    const nodes = elements.messages.querySelectorAll('.message-content, .system-message');

    nodes.forEach((node) => {
        const raw = node.dataset.rawText || node.textContent || '';
        node.textContent = raw;

        if (!term) {
            return;
        }

        const lowerRaw = raw.toLowerCase();
        const lowerTerm = term.toLowerCase();
        const index = lowerRaw.indexOf(lowerTerm);

        if (index === -1) {
            return;
        }

        const before = raw.slice(0, index);
        const match = raw.slice(index, index + term.length);
        const after = raw.slice(index + term.length);
        const fragment = document.createDocumentFragment();
        const mark = document.createElement('mark');
        mark.textContent = match;

        fragment.append(document.createTextNode(before), mark, document.createTextNode(after));
        node.innerHTML = '';
        node.appendChild(fragment);
    });
}

/**
 * Elimina historial del chat activo sólo del lado del cliente.
 */
function deleteActiveConversation() {
    closeMenus();
    if (!state.activeChat) {
        return;
    }

    const confirmed = window.confirm('¿Eliminar esta conversación del lado de este navegador?');
    if (!confirmed) {
        return;
    }

    if (state.activeChat.type === 'global') {
        state.globalMessages = [];
    }

    if (state.activeChat.type === 'private') {
        const key = getPrivateKey(state.activeChat.name);
        if (state.privateConversations[key]) {
            state.privateConversations[key].messages = [];
            state.privateConversations[key].updatedAt = new Date().toISOString();
            saveLocalState();
        }
    }

    if (state.activeChat.type === 'group') {
        const group = state.groups.find((item) => item.id === state.activeChat.id);
        if (group) {
            group.history = [];
        }
    }

    renderChatList();
    renderActiveChatMessages();
}

/**
 * Configura cambio de tema claro/oscuro.
 */
function setupThemeToggle() {
    const savedTheme = localStorage.getItem('chat-theme') || 'dark';
    document.body.dataset.theme = savedTheme;
    elements.themeToggle.querySelector('.rail-icon').textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    elements.themeToggle.addEventListener('click', () => {
        const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
        document.body.dataset.theme = nextTheme;
        localStorage.setItem('chat-theme', nextTheme);
        elements.themeToggle.querySelector('.rail-icon').textContent = nextTheme === 'dark' ? '☀️' : '🌙';
    });
}

/**
 * Configura eventos de navegación principal.
 */
function setupNavigation() {
    elements.navGlobal.addEventListener('click', selectGlobalChat);
    elements.navPrivate.addEventListener('click', () => setActiveSection('private', false));
    elements.navCommunities.addEventListener('click', () => setActiveSection('communities', false));
}

/**
 * Configura el botón hamburguesa para móviles.
 */
function setupSidebarToggle() {
    elements.sidebarToggle.addEventListener('click', () => {
        elements.userSidebar.classList.toggle('is-open');
    });
}

/**
 * Configura búsqueda de lista por sección activa.
 */
function setupListSearch() {
    elements.userSearchInput.addEventListener('input', renderChatList);
}

/**
 * Cierra menús si el usuario hace clic fuera de ellos.
 * @param {MouseEvent} event Evento global.
 */
function handleDocumentClick(event) {
    const target = event.target;
    const clickedListMenu = elements.listMenu.contains(target) || elements.listMenuButton.contains(target);
    const clickedChatMenu = elements.chatMenu.contains(target) || elements.chatMenuButton.contains(target);

    if (!clickedListMenu && !clickedChatMenu) {
        closeMenus();
    }
}

// ─── Add Members Modal ────────────────────────────────────────────────────────

/**
 * Abre el modal para agregar miembros a un grupo existente.
 * @param {object} group Grupo seleccionado.
 */
function openAddMembersModal(group) {
    const modal = document.getElementById('addMembersModal');
    const list = document.getElementById('addMembersList');
    const error = document.getElementById('addMembersError');
    error.textContent = '';
    list.innerHTML = '';

    const currentMemberIds = new Set((group.members || []).map((m) => m.id));
    const available = state.users.filter((u) => u.id !== state.selfId && !currentMemberIds.has(u.id));

    if (!available.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-list-text';
        empty.textContent = 'No hay usuarios activos para agregar.';
        list.appendChild(empty);
    } else {
        available.forEach((user) => {
            const label = document.createElement('label');
            label.className = 'participant-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = user.id;
            const avatar = document.createElement('span');
            avatar.className = 'chat-list-avatar';
            avatar.textContent = getInitials(user.nickname);
            const name = document.createElement('span');
            name.textContent = user.nickname;
            label.append(checkbox, avatar, name);
            list.appendChild(label);
        });
    }

    modal.dataset.groupId = group.id;
    modal.classList.remove('hidden');
}

/**
 * Confirma y envía la solicitud de agregar miembros al servidor.
 */
function confirmAddMembers() {
    const modal = document.getElementById('addMembersModal');
    const list = document.getElementById('addMembersList');
    const error = document.getElementById('addMembersError');
    const groupId = modal.dataset.groupId;
    const memberIds = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value);

    if (!memberIds.length) {
        error.textContent = 'Selecciona al menos un usuario.';
        return;
    }

    sendJson({ type: 'add_group_members', payload: { groupId, memberIds }, timestamp: new Date().toISOString() });
    modal.classList.add('hidden');
}

// ─── Invite Link ──────────────────────────────────────────────────────────────

/**
 * Solicita al servidor un token de invitación para el grupo.
 * @param {object} group Grupo activo.
 */
function requestInviteLink(group) {
    sendJson({ type: 'generate_invite', payload: { groupId: group.id }, timestamp: new Date().toISOString() });
}

/**
 * Muestra el modal con el link de invitación recibido del servidor.
 * @param {{token:string}} payload Datos del token.
 */
function showInviteLink(payload) {
    const modal = document.getElementById('inviteLinkModal');
    const input = document.getElementById('inviteLinkInput');
    const copied = document.getElementById('inviteLinkCopied');
    copied.style.display = 'none';
    const url = `${window.location.origin}?invite=${payload.token}`;
    input.value = url;
    modal.classList.remove('hidden');
}

/**
 * Verifica si la URL tiene un token de invitación y une al usuario al grupo.
 */
function checkInviteToken() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token && state.selfId) {
        sendJson({ type: 'join_by_invite', payload: { token }, timestamp: new Date().toISOString() });
        window.history.replaceState({}, '', window.location.pathname);
    }
}

/**
 * Inicializa eventos principales de la aplicación.
 */
function initApp() {
    setupThemeToggle();
    setupNavigation();
    setupSidebarToggle();
    setupListSearch();
    updateSelfIdentity();
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    updateComposerState();

    initEmojiPicker({
        button: elements.emojiButton,
        picker: elements.emojiPicker,
        input: elements.messageInput
    });

    setupTypingEvents({
        input: elements.messageInput,
        sendTyping: (isTyping) => sendJson({
            type: 'typing',
            payload: { isTyping },
            timestamp: new Date().toISOString()
        })
    });

    elements.loginForm.addEventListener('submit', handleLoginSubmit);
    elements.messageForm.addEventListener('submit', handleMessageSubmit);
    elements.listMenuButton.addEventListener('click', toggleListMenu);
    elements.chatMenuButton.addEventListener('click', toggleChatMenu);
    elements.openGroupModalButton.addEventListener('click', openGroupModal);
    elements.groupForm.addEventListener('submit', handleGroupSubmit);
    elements.closeGroupModalButton.addEventListener('click', closeGroupModal);
    elements.cancelGroupButton.addEventListener('click', closeGroupModal);
    elements.conversationSearchButton.addEventListener('click', toggleConversationSearch);
    elements.closeConversationSearch.addEventListener('click', clearConversationSearch);
    elements.conversationSearchInput.addEventListener('input', applyConversationSearch);
    elements.deleteConversationButton.addEventListener('click', deleteActiveConversation);
    document.addEventListener('click', handleDocumentClick);

    document.getElementById('closeAddMembersButton').addEventListener('click', () => {
        document.getElementById('addMembersModal').classList.add('hidden');
    });
    document.getElementById('cancelAddMembersButton').addEventListener('click', () => {
        document.getElementById('addMembersModal').classList.add('hidden');
    });
    document.getElementById('confirmAddMembersButton').addEventListener('click', confirmAddMembers);
    document.getElementById('closeInviteLinkButton').addEventListener('click', () => {
        document.getElementById('inviteLinkModal').classList.add('hidden');
    });
    document.getElementById('copyInviteLinkButton').addEventListener('click', () => {
        const input = document.getElementById('inviteLinkInput');
        navigator.clipboard.writeText(input.value).then(() => {
            const copied = document.getElementById('inviteLinkCopied');
            copied.style.display = 'block';
            setTimeout(() => { copied.style.display = 'none'; }, 2000);
        });
    });
}

initApp();
