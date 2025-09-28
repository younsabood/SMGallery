import { sendTelegramMessage, answerCallbackQuery } from './telegram.js';
import { 
    clearUserSession, 
    getUserSession, 
    saveUserSession, 
    createDeleteRequest, 
    getPendingRequestByTargetId, 
    deleteRequest, 
    getSubmissionRequestByIdAndUser 
} from './database.js';
import { getKeyboard, STATES, createMainKeyboard } from './ui.js';
import { showUserRequests, startUploadProcess, showHelp, completeRequest, showMyAdditions } from './actions.js';
import { calculateAge } from './utils.js';

const COMMANDS = {
    START: '/start',
    ADD: 'إضافة شهيد جديد',
    UPLOAD: '/upload',
    HELP: 'مساعدة',
    HELP_CMD: '/help',
    MY_REQUESTS: 'عرض طلباتي',
    MY_REQUESTS_CMD: '/my_requests',
    MY_ADDITIONS: 'عرض اضافاتي',
    CANCEL: 'إلغاء',
    CANCEL_CMD: '/cancel'
};

const STATE_MACHINE_CONFIG = {
    [STATES.WAITING_FIRST_NAME]: {
        nextState: STATES.WAITING_FATHER_NAME,
        prompt: (data) => `الرجاء إدخال اسم الأب: ${(data.father_name) ? `(الحالي: ${data.father_name})` : ''}`,
        sessionKey: 'first_name'
    },
    [STATES.WAITING_FATHER_NAME]: {
        nextState: STATES.WAITING_FAMILY_NAME,
        prompt: (data) => `الرجاء إدخال اسم العائلة: ${(data.family_name) ? `(الحالي: ${data.family_name})` : ''}`,
        sessionKey: 'father_name'
    },
    [STATES.WAITING_FAMILY_NAME]: {
        nextState: STATES.WAITING_BIRTH_DATE,
        prompt: (data) => `الرجاء إدخال تاريخ الولادة (مثال: 1990/01/15): ${(data.birth_date) ? `(الحالي: ${data.birth_date})` : ''}`,
        sessionKey: 'family_name'
    },
    [STATES.WAITING_BIRTH_DATE]: {
        nextState: STATES.WAITING_MARTYRDOM_DATE,
        prompt: (data) => `الرجاء إدخال تاريخ الاستشهاد (مثال: 2024/03/15): ${(data.martyrdom_date) ? `(الحالي: ${data.martyrdom_date})` : ''}`,
        sessionKey: 'birth_date'
    },
    [STATES.WAITING_MARTYRDOM_DATE]: {
        nextState: STATES.WAITING_PLACE,
        prompt: (data) => `الرجاء إدخال مكان الاستشهاد: ${(data.place) ? `(الحالي: ${data.place})` : ''}`,
        sessionKey: 'martyrdom_date',
        onTransition: (sessionData) => {
            sessionData.age = calculateAge(sessionData.birth_date, sessionData.martyrdom_date);
        }
    },
    [STATES.WAITING_PLACE]: {
        nextState: STATES.WAITING_PHOTO,
        prompt: () => "الرجاء إرسال صورة الشهيد الجديدة:\n\n(إذا كنت لا تريد تغيير الصورة الحالية، أرسل أي نص مثل 'تخطي')",
        sessionKey: 'place'
    }
};


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

    switch (text) {
        case COMMANDS.START:
            await clearUserSession(userId, env);
            const welcomeText = `أهلاً وسهلاً بك في بوت معرض شهداء الساحل السوري...`; // Truncated for brevity
            await sendTelegramMessage(chatId, { text: welcomeText, replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE)) }, env);
            break;
        case COMMANDS.ADD:
        case COMMANDS.UPLOAD:
            await startUploadProcess(chatId, userId, userInfo, env);
            break;
        case COMMANDS.HELP:
        case COMMANDS.HELP_CMD:
            await showHelp(chatId, env);
            break;
        case COMMANDS.MY_REQUESTS:
        case COMMANDS.MY_REQUESTS_CMD:
            await showUserRequests(chatId, userId, env);
            break;
        case COMMANDS.MY_ADDITIONS:
            await showMyAdditions(chatId, userId, env);
            break;
        case COMMANDS.CANCEL:
        case COMMANDS.CANCEL_CMD:
            await clearUserSession(userId, env);
            await sendTelegramMessage(chatId, { text: "تم إلغاء العملية الحالية.", replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE)) }, env);
            break;
        default:
            await handleUserInput(chatId, userId, text, env);
            break;
    }
}

async function handleUserInput(chatId, userId, text, env) {
    const session = await getUserSession(userId, env);
    console.log(`User ${userId} input: "${text}" with session state: ${session.state}`);

    if (session.state === STATES.IDLE) {
        await sendTelegramMessage(chatId, { text: "لا توجد عملية جارية.", replyMarkup: getKeyboard(createMainKeyboard(session.state)) }, env);
        return;
    }

    const stateConfig = STATE_MACHINE_CONFIG[session.state];

    if (stateConfig) {
        session.data[stateConfig.sessionKey] = text.trim();
        session.state = stateConfig.nextState;

        if (stateConfig.onTransition) {
            stateConfig.onTransition(session.data);
        }

        await saveUserSession(userId, session, env);
        await sendTelegramMessage(chatId, { text: stateConfig.prompt(session.data), replyMarkup: getKeyboard(['إلغاء']) }, env);

    } else if (session.state === STATES.WAITING_PHOTO) {
        if (session.editInfo && session.editInfo.isEditing && text) {
            await completeRequest(chatId, userId, session, env, true); // skipPhoto=true
        }
    } else {
        // Should not happen in normal flow
        console.warn(`Unhandled state: ${session.state}`);
    }
}

export async function handlePhotoMessage(chatId, userId, photoData, caption = '', env) {
    console.log(`Handling photo message from user ${userId}.`);
    const session = await getUserSession(userId, env);

    if (session.state !== STATES.WAITING_PHOTO) {
        await sendTelegramMessage(chatId, { text: "يرجى اتباع الخطوات بالترتيب.", replyMarkup: getKeyboard(createMainKeyboard(session.state)) }, env);
        return;
    }

    const photo = photoData[photoData.length - 1];
    session.data.photo_file_id = photo.file_id;
    session.data.photo_caption = caption;

    await completeRequest(chatId, userId, session, env);
}

export async function handleCallbackQuery(chatId, userId, callbackQuery, env) {
    const [action, ...params] = callbackQuery.data.split('_');
    const requestId = params.pop();
    const actionType = [action, ...params].join('_');

    await answerCallbackQuery(callbackQuery.id, env, 'جاري معالجة طلبك...');

    if (actionType === 'pending_delete' || actionType === 'rejected_delete') {
        const success = await deleteRequest(requestId, env);
        const message = success ? "تم حذف الطلب بنجاح." : "حدث خطأ أثناء حذف الطلب.";
        await sendTelegramMessage(chatId, { text: message }, env);
        return;
    }

    const originalRequest = await getSubmissionRequestByIdAndUser(requestId, userId, env);

    if (!originalRequest) {
        await sendTelegramMessage(chatId, { text: "لم يتم العثور على الطلب أو لا تملك صلاحية الوصول إليه." }, env);
        return;
    }

    const userInfo = callbackQuery.from;

    if (actionType === 'pending_edit') {
        await startUploadProcess(chatId, userId, userInfo, env, originalRequest, true);
        return;
    }

    const existingPendingRequest = await getPendingRequestByTargetId(originalRequest.id, env);
    if (existingPendingRequest) {
        await sendTelegramMessage(chatId, { text: `يوجد طلب ${existingPendingRequest.type} قيد المراجعة بالفعل لهذا الشهيد.` }, env);
        return;
    }

    if (action === 'delete') {
        const success = await createDeleteRequest(userId, originalRequest, env);
        const message = success ? `تم إرسال طلب لحذف الشهيد "<b>${originalRequest.full_name}</b>".` : "حدث خطأ أثناء إنشاء طلب الحذف.";
        await sendTelegramMessage(chatId, { text: message }, env);
    } else if (action === 'edit') {
        await startUploadProcess(chatId, userId, userInfo, env, originalRequest, false);
    }
}