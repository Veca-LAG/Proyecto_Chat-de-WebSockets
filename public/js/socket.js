import { state, RECONNECT_BASE_DELAY, RECONNECT_MAX_DELAY } from './state.js';
import { updateConnectionStatus, setAuthLoading } from './modules/auth.js';
import { handleServerMessage } from './dispatch.js';
import { playUserOnlineSound } from '../sounds/sound.js';

export function getWebSocketUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
}

export function sendJson(data) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
    state.socket.send(JSON.stringify(data));
    return true;
}

export function scheduleReconnect() {
    state.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_BASE_DELAY * state.reconnectAttempts, RECONNECT_MAX_DELAY);
    window.setTimeout(() => {
        if (state.nickname && (!state.socket || state.socket.readyState === WebSocket.CLOSED)) {
            connectWebSocket({ type: 'resume', payload: { sessionToken: state.sessionToken } });
        }
    }, delay);
}

export function connectWebSocket(authRequest = null) {
    if (state.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.socket.readyState)) {
        state.socket.close();
    }

    updateConnectionStatus('connecting');
    state.socket = new WebSocket(getWebSocketUrl());
    state.pendingAuthRequest = authRequest;

    state.socket.addEventListener('open', () => {
        const isReconnect = state.reconnectAttempts > 0;
        state.reconnectAttempts = 0;
        state.shouldReconnect = true;
        updateConnectionStatus('connected');
        if (isReconnect) playUserOnlineSound();

        const request = state.pendingAuthRequest || (
            state.sessionToken
                ? { type: 'resume', payload: { sessionToken: state.sessionToken } }
                : null
        );

        if (request) {
            sendJson({ ...request, timestamp: new Date().toISOString() });
        }
    });

    state.socket.addEventListener('message', (event) => {
        handleServerMessage(event.data);
    });

    state.socket.addEventListener('close', () => {
        updateConnectionStatus('disconnected');
        setAuthLoading(false);
        if (state.shouldReconnect && state.sessionToken) scheduleReconnect();
    });

    state.socket.addEventListener('error', () => {
        updateConnectionStatus('disconnected');
        setAuthLoading(false);
    });
}
