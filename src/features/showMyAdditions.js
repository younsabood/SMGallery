import { sendTelegramMessage } from '../shared/telegram.js';
import { getKeyboard, createMainKeyboard, STATES, displayItems } from '../shared/ui.js';
import { getUserAdditions } from '../shared/database.js';

function formatMartyr(martyr) {
    const caption = `
<b>الاسم الكامل:</b> ${martyr.full_name || 'غير متوفر'}
<b>العمر عند الاستشهاد:</b> ${martyr.age || 'غير متوفر'}
<b>تاريخ الولادة:</b> ${martyr.date_birth || 'غير متوفر'}
<b>تاريخ الاستشهاد:</b> ${martyr.date_martyrdom || 'غير متوفر'}
<b>مكان الاستشهاد:</b> ${martyr.place || 'غير متوفر'}
    `.trim();

    const inlineKeyboard = {
        inline_keyboard: [[{
            text: '✏️ تعديل',
            callback_data: `edit_${martyr.id}`
        }, {
            text: '🗑️ حذف',
            callback_data: `delete_${martyr.id}`
        }]]
    };

    return { caption, inlineKeyboard };
}

export async function handleShowMyAdditions(chatId, userId, env) {
    try {
        const martyrs = await getUserAdditions(userId, env);
        await displayItems(
            chatId, env, martyrs,
            '<b>الشهداء الذين أضفتهم:</b>',
            formatMartyr,
            'لم تقم بإضافة أي شهيد حتى الآن.'
        );
    } catch (error) {
        console.error('Error showing user additions:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض إضافاتك.",
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
    }
}
