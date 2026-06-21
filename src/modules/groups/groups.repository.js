'use strict';

const pool = require('../../db/pool');

async function findGroupsByUser(userId) {
    const result = await pool.query(
        `SELECT g.id, g.name, g.created_by, g.created_at, gm.role AS self_role
         FROM groups g
         INNER JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = $1 AND COALESCE(gm.hidden_for_user, FALSE) = FALSE AND g.deleted_at IS NULL
         ORDER BY g.created_at DESC`,
        [userId]
    );
    return result.rows;
}

async function findGroupById(groupId) {
    const result = await pool.query(
        `SELECT * FROM groups WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [groupId]
    );
    return result.rows[0] || null;
}

async function findGroupMembers(groupId) {
    const result = await pool.query(
        `SELECT u.id, u.code, u.first_name, u.last_name, u.nickname, gm.role
         FROM group_members gm
         INNER JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1
         ORDER BY u.nickname ASC`,
        [groupId]
    );
    return result.rows;
}

async function findGroupMemberIds(groupId) {
    const result = await pool.query(
        `SELECT user_id FROM group_members WHERE group_id = $1`, [groupId]
    );
    return result.rows.map((r) => r.user_id);
}

async function getGroupRole(groupId, userId) {
    const result = await pool.query(
        `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, userId]
    );
    return result.rows[0]?.role || null;
}

async function createGroup(name, createdBy) {
    const result = await pool.query(
        `INSERT INTO groups(name, created_by, created_at) VALUES($1,$2,NOW()) RETURNING *`,
        [name, createdBy]
    );
    return result.rows[0];
}

async function addGroupMember(groupId, userId, role = 'member') {
    await pool.query(
        `INSERT INTO group_members(group_id, user_id, role)
         VALUES($1,$2,$3)
         ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [groupId, userId, role]
    );
}

async function removeGroupMember(groupId, userId) {
    await pool.query(
        `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, userId]
    );
}

async function softDeleteGroup(groupId) {
    await pool.query(
        `UPDATE groups SET deleted_at = NOW() WHERE id = $1`, [groupId]
    );
}

async function hideGroupForUser(groupId, userId) {
    await pool.query(
        `UPDATE group_members SET hidden_for_user = TRUE WHERE group_id = $1 AND user_id = $2`,
        [groupId, userId]
    );
}

module.exports = {
    findGroupsByUser,
    findGroupById,
    findGroupMembers,
    findGroupMemberIds,
    getGroupRole,
    createGroup,
    addGroupMember,
    removeGroupMember,
    softDeleteGroup,
    hideGroupForUser
};
