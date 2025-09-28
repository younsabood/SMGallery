import { sendTelegramMessage, answerCallbackQuery } from './telegram.js';
import { clearUserSession, getUserSession, saveUserSession, createDeleteRequest, getPendingRequestByTargetId, deleteRequest } from './database.js';
import { getKeyboard, STATES, createMainKeyboard } from './ui.js';
import { showUserRequests, startUploadProcess, showHelp, completeRequest, showMyAdditions } from './actions.js';
import { calculateAge } from './utils.js';

export async function handleTextMessage(chatId, userId, text, userInfo, env) {
    try {
        console.log(`Handling text message from user ${userId}: "${text}"`);
        await processUserCommand(chatId, userId, text, userInfo, env);
    } catch (error) {
        console.error('Error in handleTextMessage:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى."
        }, env);
    }
}

async function processUserCommand(chatId, userId, text, userInfo, env) {
    console.log(`Processing user command: ${text}`);

    if (text === '/start') {
        await clearUserSession(userId, env);
        const welcomeText = `أهلاً وسهلاً بك في بوت معرض شهداء الساحل السوري

رحمهم الله وأسكنهم فسيح جناته

الأوامر المتاحة:
• إضافة شهيد جديد
• عرض طلباتي
• عرض اضافاتي
• المساعدة

لبدء إضافة شهيد جديد، اضغط على <b>إضافة شهيد جديد</b>`;

        await sendTelegramMessage(chatId, {
            text: welcomeText,
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
        return;
    }

    if (text === 'إضافة شهيد جديد' || text === '/upload') {
        await startUploadProcess(chatId, userId, userInfo, env);
    } else if (text === 'مساعدة' || text === '/help') {
        const session = await getUserSession(userId, env);
        await showHelp(chatId, env, session.state);
    } else if (text === 'عرض طلباتي' || text === '/my_requests') {
        await showUserRequests(chatId, userId, env);
    } else if (text === 'عرض اضافاتي') {
        await showMyAdditions(chatId, userId, env);
    } else if (text === 'إلغاء' || text === '/cancel') {
        await clearUserSession(userId, env);
        await sendTelegramMessage(chatId, {
            text: "تم إلغاء العملية الحالية\n\nيمكنك البدء من جديد",
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
    } else {
        await handleUserInput(chatId, userId, text, env);
    }
}

async function handleUserInput(chatId, userId, text, env) {
    const session = await getUserSession(userId, env);
    console.log(`User ${userId} input: "${text}" with session state: ${session.state}`);

    if (session.state === STATES.IDLE) {
        await sendTelegramMessage(chatId, {
            text: "لا توجد عملية جارية. استخدم أحد الأزرار في القائمة.",
            replyMarkup: getKeyboard(createMainKeyboard(session.state))
        }, env);
        return;
    }

    const currentState = session.state;
    const sessionData = session.data;
    const isEditing = session.editInfo && session.editInfo.isEditing;

    switch (currentState) {
        case STATES.WAITING_FIRST_NAME:
            sessionData.first_name = text.trim();
            session.state = STATES.WAITING_FATHER_NAME;
            await sendTelegramMessage(chatId, {
                text: `الرجاء إدخال اسم الأب: ${isEditing ? `(الحالي: ${session.data.father_name})` : ''}`,
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_FATHER_NAME:
            sessionData.father_name = text.trim();
            session.state = STATES.WAITING_FAMILY_NAME;
            await sendTelegramMessage(chatId, {
                text: `الرجاء إدخال اسم العائلة: ${isEditing ? `(الحالي: ${session.data.family_name})` : ''}`,
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_FAMILY_NAME:
            sessionData.family_name = text.trim();
            session.state = STATES.WAITING_BIRTH_DATE;
            await sendTelegramMessage(chatId, {
                text: `الرجاء إدخال تاريخ الولادة (مثال: 1990/01/15): ${isEditing ? `(الحالي: ${session.data.birth_date})` : ''}`,
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_BIRTH_DATE:
            sessionData.birth_date = text.trim();
            session.state = STATES.WAITING_MARTYRDOM_DATE;
            await sendTelegramMessage(chatId, {
                text: `الرجاء إدخال تاريخ الاستشهاد (مثال: 2024/03/15): ${isEditing ? `(الحالي: ${session.data.martyrdom_date})` : ''}`,
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_MARTYRDOM_DATE:
            sessionData.martyrdom_date = text.trim();
            sessionData.age = calculateAge(sessionData.birth_date, sessionData.martyrdom_date);
            session.state = STATES.WAITING_PLACE;
            await sendTelegramMessage(chatId, {
                text: `الرجاء إدخال مكان الاستشهاد: ${isEditing ? `(الحالي: ${session.data.place})` : ''}`,
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_PLACE:
            sessionData.place = text.trim();
            session.state = STATES.WAITING_PHOTO;
            await sendTelegramMessage(chatId, {
                text: "الرجاء إرسال صورة الشهيد الجديدة:\n\n(إذا كنت لا تريد تغيير الصورة الحالية، أرسل أي نص مثل 'تخطي')",
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;
            
        case STATES.WAITING_PHOTO:
             // If user sends text instead of a photo during an edit, we skip the photo upload.
            if (isEditing && text) {
                await completeRequest(chatId, userId, session, env, true); // Pass skipPhoto=true
                return;
            }
            break;
    }
    await saveUserSession(userId, session, env);
}

export async function handlePhotoMessage(chatId, userId, photoData, caption = '', env) {
    console.log(`Handling photo message from user ${userId}.`);
    const session = await getUserSession(userId, env);

    if (session.state !== STATES.WAITING_PHOTO) {
        await sendTelegramMessage(chatId, {
            text: "يرجى اتباع الخطوات بالترتيب\n\nاستخدم <b>إضافة شهيد جديد</b> لبدء الإضافة",
            replyMarkup: getKeyboard(createMainKeyboard(session.state))
        }, env);
        return;
    }

    const photo = photoData[photoData.length - 1];
    const photoFileId = photo.file_id;
    session.data.photo_file_id = photoFileId;
    session.data.photo_caption = caption;

    await completeRequest(chatId, userId, session, env);
}

export async function handleCallbackQuery(chatId, userId, callbackQuery, env) {
    const parts = callbackQuery.data.split('_');
    const action = parts[0];
    const actionType = parts.length > 2 ? `${parts[0]}_${parts[1]}` : action;
    const requestId = parts.length > 2 ? parts[2] : parts[1];

    await answerCallbackQuery(callbackQuery.id, env, 'جاري معالجة طلبك...');

    // Handle instant actions first
    if (actionType === 'pending_delete' || actionType === 'rejected_delete') {
        const success = await deleteRequest(requestId, env);
        if (success) {
            await sendTelegramMessage(chatId, { text: "تم حذف الطلب بنجاح." }, env);
        } else {
            await sendTelegramMessage(chatId, { text: "حدث خطأ أثناء حذف الطلب." }, env);
        }
        return;
    }

    // For other actions, fetch the original request
    const { results } = await env.DB.prepare('SELECT * FROM submission_requests WHERE id = ? AND user_id = ?').bind(requestId, userId).all();

    if (!results || results.length === 0) {
        await sendTelegramMessage(chatId, { text: "لم يتم العثور على الطلب أو لا تملك صلاحية الوصول إليه." }, env);
        return;
    }
    const originalRequest = results[0];

    const userInfo = {
        telegram_id: callbackQuery.from.id,
        first_name: callbackQuery.from.first_name || '',
        last_name: callbackQuery.from.last_name || '',
        username: callbackQuery.from.username || ''
    };

    if (actionType === 'pending_edit') {
        // Start the upload process with the isPendingEdit flag set to true
        await startUploadProcess(chatId, userId, userInfo, env, originalRequest, true);
        return;
    }

    // Standard edit/delete for approved requests
    // Check for existing pending requests on the same target
    const existingPendingRequest = await getPendingRequestByTargetId(originalRequest.id, env);
    if (existingPendingRequest) {
        // Inform the user that there's already a pending request
        await sendTelegramMessage(chatId, { text: `يوجد طلب ${existingPendingRequest.type} قيد المراجعة بالفعل لهذا الشهيد.` }, env);
        return;
    }

    if (action === 'delete') {
        const success = await createDeleteRequest(userId, originalRequest, env);
        if (success) {
            await sendTelegramMessage(chatId, { text: `تم إرسال طلب لحذف الشهيد "<b>${originalRequest.full_name}</b>". سيتم مراجعته من قبل الإدارة.` }, env);
        } else {
            await sendTelegramMessage(chatId, { text: "حدث خطأ أثناء إنشاء طلب الحذف." }, env);
        }
    } else if (action === 'edit') {
        await startUploadProcess(chatId, userId, userInfo, env, originalRequest, false);
    }
}
