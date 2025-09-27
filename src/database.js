import { generateRequestId } from './utils.js';
import { REQUEST_STATUS, REQUEST_TYPE, STATES } from './ui.js';

export async function saveUserSession(userId, sessionData, env) {
    try {
        await env.DB.prepare(
            'INSERT OR REPLACE INTO sessions (user_id, state, data, user_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
            userId,
            sessionData.state,
            JSON.stringify(sessionData), // Save the whole session object in data
            JSON.stringify(sessionData.userInfo),
            new Date().toISOString(),
            new Date().toISOString()
        ).run();
        console.log(`Session saved for user ${userId} using D1.`);
        return true;
    } catch (error) {
        console.error(`Error saving session for user ${userId}:`, error.message);
        return false;
    }
}


export async function getUserSession(userId, env) {
    try {
        const result = await env.DB.prepare('SELECT data FROM sessions WHERE user_id = ?').bind(userId).first();
        if (result && result.data) {
            const session = JSON.parse(result.data);
            console.log(`Session retrieved for user ${userId}. State: ${session.state}`);
            return session;
        }
    } catch (error) {
        console.error(`Error retrieving session for user ${userId}:`, error.message);
    }
    console.log(`No session found for user ${userId}.`);
    return {
        state: STATES.IDLE,
        data: {},
        userInfo: {}
    };
}


export async function clearUserSession(userId, env) {
    try {
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
        console.log(`Session cleared for user ${userId} from D1.`);
        return true;
    } catch (error) {
        console.error(`Error clearing session for user ${userId}:`, error.message);
        return false;
    }
}

export async function isUserBlocked(userId, env) {
    try {
        const result = await env.DB.prepare('SELECT is_block FROM block WHERE telegram_id = ?').bind(userId).first('is_block');
        return result === 1;
    } catch (error) {
        console.error('Error checking user block status:', error);
        return false;
    }
}

export async function getPendingRequestByTargetId(targetMartyrId, env) {
    try {
        const result = await env.DB.prepare(
            "SELECT * FROM submission_requests WHERE target_martyr_id = ? AND status = 'pending'"
        ).bind(targetMartyrId).first();
        return result || null;
    } catch (error) {
        console.error('Error getting pending request by target ID:', error);
        return null;
    }
}

export async function saveRequest(userId, requestData, env, type = REQUEST_TYPE.ADD, targetId = null) {
    try {
        const result = await env.DB.prepare(
            `INSERT INTO submission_requests (id, user_id, full_name, name_first, name_father, name_family, age, date_birth, date_martyrdom, place, image_url, status, type, target_martyr_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
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
        ).run();

        console.log(`Request saved with ID: ${result.meta.last_row_id}`);
        return result.meta.last_row_id;
    } catch (error) {
        console.error(`Error saving request:`, error.message);
        return null;
    }
}

export async function createDeleteRequest(userId, originalRequest, env) {
    try {
        await env.DB.prepare(
            `INSERT INTO submission_requests (id, user_id, full_name, name_first, name_father, name_family, age, date_birth, date_martyrdom, place, image_url, status, type, target_martyr_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
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
            originalRequest.id, // target_martyr_id is the id of the request being deleted
            new Date().toISOString()
        ).run();
        console.log(`Delete request created for martyr ID: ${originalRequest.id}`);
        return true;
    } catch (error) {
        console.error('Error creating delete request:', error);
        return false;
    }
}

export async function deleteRequest(requestId, env) {
    try {
        await env.DB.prepare('DELETE FROM submission_requests WHERE id = ?').bind(requestId).run();
        console.log(`Request ${requestId} deleted.`);
        return true;
    } catch (error) {
        console.error(`Error deleting request ${requestId}:`, error);
        return false;
    }
}

export async function getUserRequestStatus(userId, env) {
    try {
        let status = await env.DB.prepare('SELECT * FROM block WHERE telegram_id = ?').bind(userId).first();
        if (!status) {
            // If user is not in the table, create a new entry
            await env.DB.prepare('INSERT INTO block (telegram_id) VALUES (?) ON CONFLICT(telegram_id) DO NOTHING').bind(userId).run();
            status = { telegram_id: userId, is_block: 0, reached_limit: 0, request_count: 0 };
        }
        // Convert boolean values from 0/1 to false/true
        status.is_block = !!status.is_block;
        status.reached_limit = !!status.reached_limit;
        return status;
    } catch (error) {
        console.error('Error getting user request status:', error);
        return { is_block: false, reached_limit: false, request_count: 0 }; // Default to safe values
    }
}

export async function incrementRequestCount(userId, env) {
    try {
        const result = await env.DB.prepare(
            'UPDATE block SET request_count = request_count + 1 WHERE telegram_id = ? RETURNING request_count'
        ).bind(userId).first();
        return result ? result.request_count : null;
    } catch (error) {
        console.error('Error incrementing request count:', error);
        return null;
    }
}

export async function blockUserForLimit(userId, env) {
    try {
        await env.DB.prepare(
            'UPDATE block SET is_block = 1, reached_limit = 1 WHERE telegram_id = ?'
        ).bind(userId).run();
        return true;
    } catch (error) {
        console.error('Error blocking user for limit:', error);
        return false;
    }
}

export async function resetAllRequestCounts(env) {
    try {
        await env.DB.prepare(
            'UPDATE block SET request_count = 0, reached_limit = 0, is_block = 0 WHERE reached_limit = 1'
        ).run();
        console.log('Request counts have been reset for rate-limited users.');
        return true;
    } catch (error) {
        console.error('Error resetting request counts:', error);
        return false;
    }
}

