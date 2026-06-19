'use strict';

const { sendJson, checkRateLimit, rejectRateLimited } = require('./helpers');

const { handleRegister, handleLogin, handleResume, handleLogout } = require('../modules/auth/auth.handlers');
const { handleMessage, handlePrivate, handleDeletePrivateMessage, handleDeleteGlobalMessage, handleEditMessage } = require('../modules/messages/messages.handlers');
const { handleReactMessage }    = require('../modules/reactions/reactions.handlers');
const { handleTyping }          = require('../modules/typing/typing.handlers');
const { handleToggleCensorship }= require('../modules/moderation/moderation.handlers');
const {
    handleCreateGroup,
    handleAddGroupMembers,
    handlePromoteGroupAdmin,
    handleLeaveGroup,
    handleHideGroupChat,
    handleDeleteGroupEveryone,
    handleGenerateInvite,
    handleJoinByInvite,
    handleGroupMessage,
    handleDeleteGroupMessage
} = require('../modules/groups/groups.handlers');
const {
    handleGetMyProfile,
    handleGetUserProfile,
    handleUpdateProfile,
    handleUpdatePresenceStatus,
    handleUpdateCustomStatus
} = require('../modules/profiles/profiles.handlers');

async function handleSocketMessage(ws, rawMessage) {
    let data;
    try {
        data = JSON.parse(rawMessage.toString());
    } catch {
        sendJson(ws, { type: 'error', payload: { text: 'El mensaje debe ser JSON válido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const { type, payload = {}, timestamp } = data;

    try {
        switch (type) {
            case 'register':              await handleRegister(ws, payload);              break;
            case 'login':                 await handleLogin(ws, payload);                 break;
            case 'resume':                await handleResume(ws, payload);                break;
            case 'logout':                await handleLogout(ws, payload);                break;
            case 'message':
                if (!checkRateLimit(ws)) return rejectRateLimited(ws);
                await handleMessage(ws, payload, timestamp);
                break;
            case 'private':
                if (!checkRateLimit(ws)) return rejectRateLimited(ws);
                await handlePrivate(ws, payload, timestamp);
                break;
            case 'delete_private_message':  await handleDeletePrivateMessage(ws, payload);  break;
            case 'delete_global_message':   await handleDeleteGlobalMessage(ws, payload);   break;
            case 'delete_group_message':    await handleDeleteGroupMessage(ws, payload);    break;
            case 'edit_message':            await handleEditMessage(ws, payload);           break;
            case 'react_message':           await handleReactMessage(ws, payload);          break;
            case 'typing':                  await handleTyping(ws, payload);                break;
            case 'create_group':            await handleCreateGroup(ws, payload);           break;
            case 'group_message':
                if (!checkRateLimit(ws)) return rejectRateLimited(ws);
                await handleGroupMessage(ws, payload, timestamp);
                break;
            case 'add_group_members':       await handleAddGroupMembers(ws, payload);       break;
            case 'join_by_invite':          await handleJoinByInvite(ws, payload);          break;
            case 'generate_invite':         await handleGenerateInvite(ws, payload);        break;
            case 'promote_group_admin':     await handlePromoteGroupAdmin(ws, payload);     break;
            case 'leave_group':             await handleLeaveGroup(ws, payload);            break;
            case 'hide_group_chat':         await handleHideGroupChat(ws, payload);         break;
            case 'delete_group_everyone':   await handleDeleteGroupEveryone(ws, payload);   break;
            case 'toggle_censorship':       await handleToggleCensorship(ws, payload);      break;
            case 'get_my_profile':          await handleGetMyProfile(ws);                   break;
            case 'get_user_profile':        await handleGetUserProfile(ws, payload);        break;
            case 'update_profile':          await handleUpdateProfile(ws, payload);         break;
            case 'update_presence_status':  await handleUpdatePresenceStatus(ws, payload);  break;
            case 'update_custom_status':    await handleUpdateCustomStatus(ws, payload);    break;
            default:
                sendJson(ws, { type: 'error', payload: { text: 'Tipo de mensaje no reconocido.' }, timestamp: new Date().toISOString() });
        }
    } catch (error) {
        console.error(error);
        sendJson(ws, { type: 'error', payload: { text: 'Error interno del servidor.' }, timestamp: new Date().toISOString() });
    }
}

module.exports = { handleSocketMessage };
