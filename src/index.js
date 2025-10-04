import { getUserRequestStatus, incrementRequestCount, blockUserForLimit, resetAllRequestCounts, getUserSession } from './shared/database.js';
import { sendTelegramMessage } from './shared/telegram.js';
import { getKeyboard, createMainKeyboard, STATES } from './shared/ui.js';

import { handleAddMartyr, handleMartyrInput, handleMartyrPhoto, handleMartyrCallback } from './features/addMartyr.js';
import { handleShowMyRequests } from './features/showMyRequests.js';
import { handleShowMyAdditions } from './features/showMyAdditions.js';
import { handleHelp } from './features/help.js';
import { handleCancel } from './features/cancel.js';

const COMMANDS = {
    START: '/start',
    ADD: 'إضافة شهيد جديد',
    HELP: 'مساعدة',
    MY_REQUESTS: 'عرض طلباتي',
    MY_ADDITIONS: 'عرض اضافاتي',
    CANCEL: 'إلغاء',
};

async function handleTextMessage(chatId, userId, text, userInfo, env) {
    const session = await getUserSession(userId, env);

    if (session.state !== STATES.IDLE) {
        await handleMartyrInput(chatId, userId, text, env);
        return;
    }

    switch (text) {
        case COMMANDS.START:
            await sendTelegramMessage(chatId, {
                text: "أهلاً وسهلاً بك في بوت معرض شهداء الساحل السوري...",
                replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
            }, env);
            break;
        case COMMANDS.ADD:
            await handleAddMartyr(chatId, userId, userInfo, env);
            break;
        case COMMANDS.HELP:
            await handleHelp(chatId, env);
            break;
        case COMMANDS.MY_REQUESTS:
            await handleShowMyRequests(chatId, userId, env);
            break;
        case COMMANDS.MY_ADDITIONS:
            await handleShowMyAdditions(chatId, userId, env);
            break;
        case COMMANDS.CANCEL:
            await handleCancel(chatId, userId, env);
            break;
        default:
            await sendTelegramMessage(chatId, {
                text: "أمر غير معروف. الرجاء استخدام الأزرار.",
                replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
            }, env);
            break;
    }
}

// Main handler
async function handleRequest(request, env) {
    if (request.method === 'POST') {
        try {
            const update = await request.json();
            console.log('Received update from Telegram');

            let userId;
            let chatId;
            let userInfo;

            if (update.message) {
                userId = update.message.from.id.toString();
                chatId = update.message.chat.id;
                userInfo = {
                    telegram_id: userId,
                    first_name: update.message.from.first_name || '',
                    last_name: update.message.from.last_name || '',
                    username: update.message.from.username || ''
                };
            } else if (update.callback_query) {
                userId = update.callback_query.from.id.toString();
                chatId = update.callback_query.message.chat.id;
                userInfo = {
                    telegram_id: userId,
                    first_name: update.callback_query.from.first_name || '',
                    last_name: update.callback_query.from.last_name || '',
                    username: update.callback_query.from.username || ''
                };
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
                if (update.message.text) {
                    await handleTextMessage(chatId, userId, update.message.text, userInfo, env);
                } else if (update.message.photo) {
                    const caption = update.message.caption || '';
                    await handleMartyrPhoto(chatId, userId, update.message.photo, caption, env);
                } else {
                    await sendTelegramMessage(chatId, {
                        text: "نوع الرسالة غير مدعوم. يرجى إرسال نص أو صورة فقط."
                    }, env);
                }
            } else if (update.callback_query) {
                await handleMartyrCallback(chatId, userId, update.callback_query, env);
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