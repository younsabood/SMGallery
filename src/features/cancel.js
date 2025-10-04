import { sendTelegramMessage } from '../shared/telegram.js';
import { getKeyboard, createMainKeyboard, STATES } from '../shared/ui.js';
import { clearUserSession } from '../shared/database.js';

export async function handleCancel(chatId, userId, env) {
    await clearUserSession(userId, env);
    await sendTelegramMessage(chatId, {
        text: "تم إلغاء العملية الحالية.",
        replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
    }, env);
}
