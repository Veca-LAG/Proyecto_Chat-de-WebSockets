'use strict';

const pool = require('../../db/pool');
const { MAX_HISTORY } = require('../../config');

async function findGlobalMessages(limit = MAX_HISTORY) {
    const result = await pool.query(
        `SELECT * FROM global_messages ORDER BY created_at DESC LIMIT $1`,
        [limit]
    );
    return result.rows.reverse();
}

async function insertGlobalMessage({ fromId, fromNickname, text, textOriginal, replyToId, replyAuthor, replyText, isForwarded, forwardedFromId }) {
    const result = await pool.query(
        `INSERT INTO global_messages
         (from_id, from_nickname, text, text_original, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         RETURNING *`,
        [fromId, fromNickname, text, textOriginal, replyToId, replyAuthor, replyText, isForwarded, forwardedFromId]
    );
    return result.rows[0];
}

async function deleteGlobalMessage(id) {
    await pool.query(
        `UPDATE global_messages SET deleted_for_all = TRUE, deleted_by = NULL WHERE id = $1`,
        [id]
    );
}

async function editGlobalMessage(id, text, textCensored) {
    const result = await pool.query(
        `UPDATE global_messages SET text = $2, text_censored = $3 WHERE id = $1 RETURNING *`,
        [id, text, textCensored]
    );
    return result.rows[0];
}

async function findGlobalMessageById(id) {
    const result = await pool.query(
        `SELECT * FROM global_messages WHERE id = $1 LIMIT 1`, [id]
    );
    return result.rows[0] || null;
}

async function findPrivateMessages(userId) {
    const result = await pool.query(
        `SELECT * FROM private_messages WHERE from_id = $1 OR to_id = $1 ORDER BY created_at ASC`,
        [userId]
    );
    return result.rows;
}

async function insertPrivateMessage({ fromId, fromNickname, toId, toNickname, text, textOriginal, replyToId, replyAuthor, replyText, isForwarded, forwardedFromId }) {
    const result = await pool.query(
        `INSERT INTO private_messages
         (from_id, from_nickname, to_id, to_nickname, text, text_original, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         RETURNING *`,
        [fromId, fromNickname, toId, toNickname, text, textOriginal, replyToId, replyAuthor, replyText, isForwarded, forwardedFromId]
    );
    return result.rows[0];
}

async function deletePrivateMessage(id) {
    await pool.query(
        `UPDATE private_messages SET deleted_for_all = TRUE WHERE id = $1`, [id]
    );
}

async function editPrivateMessage(id, text, textCensored) {
    const result = await pool.query(
        `UPDATE private_messages SET text = $2, text_censored = $3 WHERE id = $1 RETURNING *`,
        [id, text, textCensored]
    );
    return result.rows[0];
}

async function findPrivateMessageById(id) {
    const result = await pool.query(
        `SELECT * FROM private_messages WHERE id = $1 LIMIT 1`, [id]
    );
    return result.rows[0] || null;
}

async function findGroupMessages(groupId, limit = MAX_HISTORY) {
    const result = await pool.query(
        `SELECT * FROM group_messages WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [groupId, limit]
    );
    return result.rows.reverse();
}

async function insertGroupMessage({ groupId, groupName, fromId, fromNickname, text, textOriginal, replyToId, replyAuthor, replyText, isForwarded, forwardedFromId }) {
    const result = await pool.query(
        `INSERT INTO group_messages
         (group_id, group_name, from_id, from_nickname, text, text_original, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         RETURNING *`,
        [groupId, groupName, fromId, fromNickname, text, textOriginal, replyToId, replyAuthor, replyText, isForwarded, forwardedFromId]
    );
    return result.rows[0];
}

async function deleteGroupMessage(id) {
    await pool.query(
        `UPDATE group_messages SET deleted_for_all = TRUE WHERE id = $1`, [id]
    );
}

async function editGroupMessage(id, text, textCensored) {
    const result = await pool.query(
        `UPDATE group_messages SET text = $2, text_censored = $3 WHERE id = $1 RETURNING *`,
        [id, text, textCensored]
    );
    return result.rows[0];
}

async function findGroupMessageById(id) {
    const result = await pool.query(
        `SELECT * FROM group_messages WHERE id = $1 LIMIT 1`, [id]
    );
    return result.rows[0] || null;
}

module.exports = {
    findGlobalMessages,
    insertGlobalMessage,
    deleteGlobalMessage,
    editGlobalMessage,
    findGlobalMessageById,
    findPrivateMessages,
    insertPrivateMessage,
    deletePrivateMessage,
    editPrivateMessage,
    findPrivateMessageById,
    findGroupMessages,
    insertGroupMessage,
    deleteGroupMessage,
    editGroupMessage,
    findGroupMessageById
};
