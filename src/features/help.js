import { sendTelegramMessage } from '../shared/telegram.js';
import { getKeyboard, createMainKeyboard, STATES } from '../shared/ui.js';

export async function handleHelp(chatId, env) {
    const helpText = `مساعدة بوت معرض شهداء الساحل السوري\n\n<b>إضافة شهيد جديد:</b>\nيمكنك إضافة شهيد جديد باتباع الخطوات المطلوبة\n\n<b>عرض طلباتي:</b>\nيمكنك مشاهدة حالة جميع طلباتك المقدمة، وطلب تعديل أو حذف المقبول منها.\n\nللمساعدة الإضافية، تواصل مع المدير: @DevYouns`;

    await sendTelegramMessage(chatId, {
        text: helpText,
        replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
    }, env);
}
