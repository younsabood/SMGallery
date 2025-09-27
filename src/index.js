import { handleTextMessage, handlePhotoMessage, handleCallbackQuery } from './handlers.js';
import { getUserRequestStatus, incrementRequestCount, blockUserForLimit, resetAllRequestCounts } from './database.js';
import { sendTelegramMessage } from './telegram.js';

// Main handler
async function handleRequest(request, env) {
    if (request.method === 'POST') {
        try {
            const update = await request.json();
            console.log('Received update from Telegram');

            let userId;
            if (update.message) {
                userId = update.message.from.id.toString();
            } else if (update.callback_query) {
                userId = update.callback_query.from.id.toString();
            }

            if (userId) {
                const userStatus = await getUserRequestStatus(userId, env);

                if (userStatus.is_block) {
                    console.log(`User ${userId} is blocked. Ignoring update.`);
                    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
                }

                const newRequestCount = await incrementRequestCount(userId, env);
                if (newRequestCount > 200) {
                    await blockUserForLimit(userId, env);
                    console.log(`User ${userId} has been blocked for exceeding the rate limit.`);
                    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
                }
            }

            if (update.message) {
                const message = update.message;
                const chatId = message.chat.id;
                const userInfo = {
                    telegram_id: userId,
                    first_name: message.from.first_name || '',
                    last_name: message.from.last_name || '',
                    username: message.from.username || ''
                };

                if (message.text) {
                    await handleTextMessage(chatId, userId, message.text, userInfo, env);
                } else if (message.photo) {
                    const caption = message.caption || '';
                    await handlePhotoMessage(chatId, userId, message.photo, caption, env);
                } else {
                    await sendTelegramMessage(chatId, {
                        text: "نوع الرسالة غير مدعوم. يرجى إرسال نص أو صورة فقط."
                    }, env);
                }
            } else if (update.callback_query) {
                const callbackQuery = update.callback_query;
                const chatId = callbackQuery.message.chat.id;
                await handleCallbackQuery(chatId, userId, callbackQuery, env);
            } else {
                console.log('Received unsupported update type.');
            }

            return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });

        } catch (error) {
            console.error('Error processing webhook:', error);
            return new Response(JSON.stringify({
                status: 'error',
                message: 'Internal error occurred',
                error: error.message
            }), { status: 500 });
        }
    } else if (request.method === 'GET') {
        return new Response(JSON.stringify({
            "status": "ok",
            "message": "Syrian Martyrs Bot is running on Cloudflare Workers!",
            "platform": "Cloudflare Workers"
        }), { status: 200 });
    }

    return new Response(JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { status: 405 });
}

// Export the handler for Cloudflare Workers
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    },
    async scheduled(event, env, ctx) {
        console.log('Running scheduled task to reset request counts...');
        await resetAllRequestCounts(env);
    }
};