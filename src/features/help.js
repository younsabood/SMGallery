import { sendTelegramMessage } from '../shared/telegram.js';
import { getKeyboard, createMainKeyboard, STATES } from '../shared/ui.js';

export async function handleHelp(chatId, env) {
    const helpText = `<b>مساعدة - بوت معرض شهداء الساحل السوري</b>

<b>- إضافة شهيد جديد:</b>
لبدء عملية إضافة بيانات شهيد، اتبع الخطوات التي يطلبها البوت لإدخال الاسم، التواريخ، المكان، والصورة.

<b>- عرض إضافاتي:</b>
لعرض قائمة بالشهداء الذين تمت الموافقة على إضافتهم من قبلك، مع إمكانية طلب تعديل أو حذف.

<b>- عرض طلباتي:</b>
لمتابعة حالة طلباتك التي قدمتها (قيد المراجعة أو المرفوضة).

<b>- إلغاء:</b>
لإلغاء أي عملية جارية والعودة إلى القائمة الرئيسية.

<i>نقدر مساهمتكم في تخليد ذكرى شهدائنا الأبرار.</i>`;

    await sendTelegramMessage(chatId, {
        text: helpText,
        replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
    }, env);
}

