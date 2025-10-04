import { sendTelegramMessage } from '../shared/telegram.js';
import { getKeyboard, createMainKeyboard, STATES, REQUEST_STATUS, displayItems } from '../shared/ui.js';
import { getUserRequestsByStatus } from '../shared/database.js';

function formatPendingRequest(req) {
    const caption = `
⏳ <b>الاسم الكامل:</b> ${req.full_name || 'غير متوفر'}
<b>العمر عند الاستشهاد:</b> ${req.age || 'غير متوفر'}
<b>تاريخ الولادة:</b> ${req.date_birth || 'غير متوفر'}
<b>تاريخ الاستشهاد:</b> ${req.date_martyrdom || 'غير متوفر'}
<b>مكان الاستشهاد:</b> ${req.place || 'غير متوفر'}
<b>الحالة:</b> قيد المراجعة
    `.trim();

    const inlineKeyboard = {
        inline_keyboard: [[{
            text: '✏️ تعديل',
            callback_data: `pending_edit_${req.id}`
        }, {
            text: '🗑️ حذف',
            callback_data: `pending_delete_${req.id}`
        }]]
    };

    return { caption, inlineKeyboard };
}

function formatRejectedRequest(req) {
    const caption = `
❌ <b>الاسم الكامل:</b> ${req.full_name || 'غير متوفر'}
<b>العمر عند الاستشهاد:</b> ${req.age || 'غير متوفر'}
<b>تاريخ الولادة:</b> ${req.date_birth || 'غير متوفر'}
<b>تاريخ الاستشهاد:</b> ${req.date_martyrdom || 'غير متوفر'}
<b>مكان الاستشهاد:</b> ${req.place || 'غير متوفر'}
<b>الحالة:</b> تم الرفض
    `.trim();

    const inlineKeyboard = {
        inline_keyboard: [[{
            text: '🗑️ حذف',
            callback_data: `rejected_delete_${req.id}`
        }]]
    };

    return { caption, inlineKeyboard };
}

export async function handleShowMyRequests(chatId, userId, env) {
    try {
        const pendingRequests = await getUserRequestsByStatus(userId, REQUEST_STATUS.PENDING, env);
        const rejectedRequests = await getUserRequestsByStatus(userId, REQUEST_STATUS.REJECTED, env);

        await displayItems(
            chatId, env, pendingRequests,
            '<b>طلباتك قيد المراجعة:</b>',
            formatPendingRequest,
            'لا توجد طلبات قيد المراجعة.'
        );

        await displayItems(
            chatId, env, rejectedRequests,
            '<b>طلباتك المرفوضة:</b>',
            formatRejectedRequest,
            'لا توجد طلبات مرفوضة.'
        );

        if (pendingRequests.length === 0 && rejectedRequests.length === 0) {
            await sendTelegramMessage(chatId, {
                text: "لا توجد لديك أي طلبات.",
                replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
            }, env);
        }

    } catch (error) {
        console.error('Error showing user requests:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض طلباتك.",
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
    }
}
