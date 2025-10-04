import { generateRequestId } from './utils.js';
import { REQUEST_STATUS, REQUEST_TYPE, STATES } from './ui.js';

/**
 * Executes a database query with specified parameters and method.
 * This centralizes query execution, error handling, and logging.
 *
 * @param {object} db - The D1 database instance (e.g., env.DB).
 * @param {string} query - The SQL query string to execute.
 * @param {Array<any>} params - An array of parameters to bind to the query.
 * @param {string} [method='run'] - The execution method ('run', 'first', 'all').
 * @param {string} [errorMessage='Error executing query'] - A specific error message for logging.
 * @returns {Promise<any>} The result of the query or null/false on error.
 */
async function executeQuery(db, query, params, method = 'run', errorMessage = 'Error executing query') {
    try {
        const stmt = db.prepare(query).bind(...params);
        const result = await stmt[method]();
        console.log(`Query executed successfully: ${query.substring(0, 60)}...`);
        if (method === 'all') {
            return result.results || [];
        }
        return result;
    } catch (error) {
        console.error(`${errorMessage}:`, error.message);
        return method === 'first' ? null : (method === 'all' ? [] : false);
    }
}

export async function saveUserSession(userId, sessionData, env) {
    const query = 'INSERT OR REPLACE INTO sessions (user_id, state, data, user_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)';
    const params = [
        userId,
        sessionData.state,
        JSON.stringify(sessionData),
        JSON.stringify(sessionData.userInfo),
        new Date().toISOString(),
        new Date().toISOString()
    ];
    return executeQuery(env.DB, query, params, 'run', `Error saving session for user ${userId}`);
}

export async function getUserSession(userId, env) {
    const query = 'SELECT data FROM sessions WHERE user_id = ?';
    const result = await executeQuery(env.DB, query, [userId], 'first', `Error retrieving session for user ${userId}`);

    if (result && result.data) {
        const session = JSON.parse(result.data);
        console.log(`Session retrieved for user ${userId}. State: ${session.state}`);
        return session;
    }

    console.log(`No session found for user ${userId}.`);
    return {
        state: STATES.IDLE,
        data: {},
        userInfo: {}
    };
}

export async function clearUserSession(userId, env) {
    const query = 'DELETE FROM sessions WHERE user_id = ?';
    return executeQuery(env.DB, query, [userId], 'run', `Error clearing session for user ${userId}`);
}

export async function isUserBlocked(userId, env) {
    const query = 'SELECT is_block FROM block WHERE telegram_id = ?';
    const result = await executeQuery(env.DB, query, [userId], 'first', 'Error checking user block status');
    return result ? result.is_block === 1 : false;
}

export async function getPendingRequestByTargetId(targetMartyrId, env) {
    const query = "SELECT * FROM submission_requests WHERE target_martyr_id = ? AND status = 'pending'";
    return executeQuery(env.DB, query, [targetMartyrId], 'first', 'Error getting pending request by target ID');
}

export async function saveRequest(userId, requestData, env, type = REQUEST_TYPE.ADD, targetId = null) {
    const query = `INSERT INTO submission_requests (id, user_id, full_name, name_first, name_father, name_family, age, date_birth, date_martyrdom, place, image_url, status, type, target_martyr_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        generateRequestId(),
        userId,
        requestData.martyrData.full_name,
        requestData.martyrData.name_first,
        requestData.martyrData.name_father,
        requestData.martyrData.name_family,
        requestData.martyrData.age,
        requestData.martyrData.date_birth,
        requestData.martyrData.date_martyrdom,
        requestData.martyrData.place,
        requestData.martyrData.imageUrl,
        REQUEST_STATUS.PENDING,
        type,
        targetId,
        new Date().toISOString()
    ];
    const result = await executeQuery(env.DB, query, params, 'run', 'Error saving request');
    return result ? result.meta.last_row_id : null;
}

export async function createDeleteRequest(userId, originalRequest, env) {
    const query = `INSERT INTO submission_requests (id, user_id, full_name, name_first, name_father, name_family, age, date_birth, date_martyrdom, place, image_url, status, type, target_martyr_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        generateRequestId(),
        userId,
        originalRequest.full_name,
        originalRequest.name_first,
        originalRequest.name_father,
        originalRequest.name_family,
        originalRequest.age,
        originalRequest.date_birth,
        originalRequest.date_martyrdom,
        originalRequest.place,
        originalRequest.image_url,
        REQUEST_STATUS.PENDING,
        REQUEST_TYPE.DELETE,
        originalRequest.id,
        new Date().toISOString()
    ];
    return executeQuery(env.DB, query, params, 'run', 'Error creating delete request');
}

export async function deleteRequest(requestId, env) {
    const query = 'DELETE FROM submission_requests WHERE id = ?';
    return executeQuery(env.DB, query, [requestId], 'run', `Error deleting request ${requestId}`);
}

export async function getUserRequestStatus(userId, env) {
    const query = 'SELECT * FROM block WHERE telegram_id = ?';
    let status = await executeQuery(env.DB, query, [userId], 'first', 'Error getting user request status');

    if (!status) {
        const insertQuery = 'INSERT INTO block (telegram_id) VALUES (?) ON CONFLICT(telegram_id) DO NOTHING';
        await executeQuery(env.DB, insertQuery, [userId]);
        status = { telegram_id: userId, is_block: 0, reached_limit: 0, request_count: 0 };
    }

    status.is_block = !!status.is_block;
    status.reached_limit = !!status.reached_limit;
    return status;
}

export async function incrementRequestCount(userId, env) {
    const query = 'UPDATE block SET request_count = request_count + 1 WHERE telegram_id = ? RETURNING request_count';
    const result = await executeQuery(env.DB, query, [userId], 'first', 'Error incrementing request count');
    return result ? result.request_count : null;
}

export async function blockUserForLimit(userId, env) {
    const query = 'UPDATE block SET is_block = 1, reached_limit = 1 WHERE telegram_id = ?';
    return executeQuery(env.DB, query, [userId], 'run', 'Error blocking user for limit');
}

export async function resetAllRequestCounts(env) {
    const query = 'UPDATE block SET request_count = 0, reached_limit = 0, is_block = 0 WHERE reached_limit = 1';
    return executeQuery(env.DB, query, [], 'run', 'Error resetting request counts');
}

export async function updateRequest(requestId, requestData, env) {
    const query = `UPDATE submission_requests SET
                      full_name = ?, name_first = ?, name_father = ?, name_family = ?,
                      age = ?, date_birth = ?, date_martyrdom = ?, place = ?,
                      image_url = ?, updated_at = ?
                   WHERE id = ?`;
    const params = [
        requestData.martyrData.full_name,
        requestData.martyrData.name_first,
        requestData.martyrData.name_father,
        requestData.martyrData.name_family,
        requestData.martyrData.age,
        requestData.martyrData.date_birth,
        requestData.martyrData.date_martyrdom,
        requestData.martyrData.place,
        requestData.martyrData.imageUrl,
        new Date().toISOString(),
        requestId
    ];
    const result = await executeQuery(env.DB, query, params, 'run', `Error updating request: ${requestId}`);
    return result ? requestId : null;
}

export async function getUserAdditions(userId, env) {
    const query = "SELECT * FROM martyrs WHERE telegram_id = ? ORDER BY created_at DESC";
    return executeQuery(env.DB, query, [userId], 'all', 'Error fetching user additions');
}

export async function getUserRequestsByStatus(userId, status, env) {
    const query = "SELECT * FROM submission_requests WHERE user_id = ? AND status = ? ORDER BY created_at DESC";
    return executeQuery(env.DB, query, [userId, status], 'all', 'Error fetching user requests by status');
}

export async function getSubmissionImageUrl(submissionId, env) {
    const query = 'SELECT image_url FROM submission_requests WHERE id = ?';
    const result = await executeQuery(env.DB, query, [submissionId], 'first', 'Error fetching submission image URL');
    return result ? result.image_url : null;
}

/**
 * Fetches a specific submission request by its ID and the user who created it.
 * @param {string} requestId - The ID of the request.
 * @param {number} userId - The user's Telegram ID.
 * @param {object} env - The environment object.
 * @returns {Promise<object|null>} The request object or null if not found.
 */
export async function getSubmissionRequestByIdAndUser(requestId, userId, env) {
    const query = "SELECT * FROM submission_requests WHERE id = ? AND user_id = ?";
    return executeQuery(env.DB, query, [requestId, userId], 'first', 'Error fetching submission request by ID and user');
}

export async function getMartyrByIdAndUser(martyrId, userId, env) {
    const query = "SELECT * FROM martyrs WHERE id = ? AND telegram_id = ?";
    return executeQuery(env.DB, query, [martyrId, userId], 'first', 'Error fetching martyr by ID and user');
}