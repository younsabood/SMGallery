import { sendTelegramMessage, uploadPhotoToImgbb, answerCallbackQuery } from '../shared/telegram.js';
import { getKeyboard, STATES, REQUEST_TYPE, createMainKeyboard } from '../shared/ui.js';
import {
    saveUserSession,
    saveRequest,
    clearUserSession,
    updateRequest,
    getSubmissionImageUrl,
    getMartyrByIdAndUser,
    getPendingRequestByTargetId,
    createDeleteRequest,
    getSubmissionRequestByIdAndUser,
    deleteRequest,
    getUserSession
} from '../shared/database.js';
import { calculateAge, parseDate } from '../shared/utils.js';

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

async function startUploadProcess(chatId, userId, userInfo, env, originalRequest = null, isPendingEdit = false) {
    console.log(`Starting process for user ${userId}. Is editing: ${!!originalRequest}`);
    const isEditing = !!originalRequest;

    const sessionData = {
        state: STATES.WAITING_FIRST_NAME,
        data: isEditing ? {
            first_name: originalRequest.name_first,
            father_name: originalRequest.name_father,
            family_name: originalRequest.name_family,
            birth_date: originalRequest.date_birth,
            martyrdom_date: originalRequest.date_martyrdom,
            place: originalRequest.place,
            photo_file_id: null,
            photo_caption: '',
        } : {},
        userInfo: userInfo,
        editInfo: isEditing ? {
            isEditing: true,
            isPendingEdit: isPendingEdit, // Flag for pending edits
            target_martyr_id: originalRequest.id
        } : { isEditing: false }
    };

    const isSessionSaved = await saveUserSession(userId, sessionData, env);
    if (isSessionSaved) {
        let initialPrompt;
        if (isEditing) {
            initialPrompt = `بدء تعديل بيانات الشهيد: <b>${originalRequest.full_name}</b>\n\nالرجاء إدخال الاسم الأول الجديد (الحالي: ${originalRequest.name_first}):`;
        } else {
            initialPrompt = "لنبدأ بإضافة شهيد جديد\n\nالرجاء إدخال الاسم الأول:";
        }
        await sendTelegramMessage(chatId, {
            text: initialPrompt,
            replyMarkup: getKeyboard(['إلغاء'])
        }, env);
    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
    }
}

async function completeRequest(chatId, userId, session, env, skipPhoto = false) {
    console.log(`Completing request for user ${userId}.`);
    const martyrData = session.data;
    const fullName = `${martyrData.first_name || ''} ${martyrData.father_name || ''} ${martyrData.family_name || ''}`.trim();

    const isEditing = session.editInfo && session.editInfo.isEditing;
    const isPendingEdit = session.editInfo && session.editInfo.isPendingEdit;
    const requestType = isEditing && !isPendingEdit ? REQUEST_TYPE.EDIT : REQUEST_TYPE.ADD;
    const targetId = isEditing ? session.editInfo.target_martyr_id : null;
    let imgbbUrl = null;

    if (!skipPhoto && martyrData.photo_file_id) {
        await sendTelegramMessage(chatId, { text: "جاري تحميل الصورة، يرجى الانتظار..." }, env);
        imgbbUrl = await uploadPhotoToImgbb(martyrData.photo_file_id, env);
        if (!imgbbUrl) {
            await sendTelegramMessage(chatId, { text: "حدث خطأ في تحميل الصورة. يرجى المحاولة مرة أخرى." }, env);
            return;
        }
    } else if (isEditing && skipPhoto) {
        imgbbUrl = await getSubmissionImageUrl(targetId, env);
    }

    if (isEditing && !imgbbUrl) {
        console.error(`Could not find original image for edit request on target ${targetId}`);
         await sendTelegramMessage(chatId, { text: "حدث خطأ في العثور على الصورة الأصلية. يرجى إعادة المحاولة وإرفاق صورة." }, env);
        return;
    }


    const requestData = {
        martyrData: {
            name_first: martyrData.first_name || '',
            name_father: martyrData.father_name || '',
            name_family: martyrData.family_name || '',
            full_name: fullName,
            age: martyrData.age || null,
            date_birth: martyrData.birth_date || '',
            date_martyrdom: martyrData.martyrdom_date || '',
            place: martyrData.place || '',
            imageUrl: imgbbUrl,
        },
        userInfo: session.userInfo
    };

    let requestId;
    if (isPendingEdit) {
        requestId = await updateRequest(targetId, requestData, env);
    } else {
        requestId = await saveRequest(userId, requestData, env, requestType, targetId);
    }

    if (requestId) {
        await clearUserSession(userId, env);

        const actionText = isPendingEdit ? "تحديث" : (isEditing ? "تعديل" : "إضافة");
        const messageSummary = `تم إرسال طلب ${actionText} بنجاح!\n\n<b>ملخص البيانات:</b>\nالاسم: ${fullName}\nالعمر: ${martyrData.age || 'غير متوفر'}\nالولادة: ${martyrData.birth_date || 'غير متوفر'}\nالاستشهاد: ${martyrData.martyrdom_date || 'غير متوفر'}\nالمكان: ${martyrData.place || 'غير متوفر'}\n\n` + (isPendingEdit ? 'تم تحديث طلبك مباشرة.' : 'سيتم مراجعة طلبك من قبل الإدارة.');

        if (!skipPhoto && martyrData.photo_file_id) {
            await sendTelegramMessage(chatId, {
                photoCaption: messageSummary,
                photoId: martyrData.photo_file_id,
                replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
            }, env);
        } else {
            await sendTelegramMessage(chatId, {
                text: messageSummary,
                replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
            }, env);
        }
    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
    }
}

export async function handleAddMartyr(chatId, userId, userInfo, env) {
    await startUploadProcess(chatId, userId, userInfo, env);
}

export async function handleMartyrInput(chatId, userId, text, env) {
    const session = await getUserSession(userId, env);
    console.log(`User ${userId} input: \"${text}\" with session state: ${session.state}`);

    if (session.state === STATES.IDLE) {
        // This should be handled in the main index.js router
        return;
    }

    const stateConfig = STATE_MACHINE_CONFIG[session.state];

    if (stateConfig) {
        const trimmedText = text.trim();

        if (session.state === STATES.WAITING_BIRTH_DATE || session.state === STATES.WAITING_MARTYRDOM_DATE) {
            const parsedDate = parseDate(trimmedText);
            if (!parsedDate) {
                await sendTelegramMessage(chatId, { text: "التنسيق غير صالح. الرجاء إدخال التاريخ بالتنسيق الصحيح (مثال: 1990/01/15)", replyMarkup: getKeyboard(['إلغاء']) }, env);
                return; // Stay in the same state
            }
        }

        session.data[stateConfig.sessionKey] = trimmedText;
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

export async function handleMartyrPhoto(chatId, userId, photoData, caption = '', env) {
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

export async function handleMartyrCallback(chatId, userId, callbackQuery, env) {
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

    // Handle actions on existing martyrs (from "My Additions")
    if (action === 'edit' || action === 'delete') {
        const originalMartyr = await getMartyrByIdAndUser(requestId, userId, env); // Use new function

        if (!originalMartyr) {
            await sendTelegramMessage(chatId, { text: "لم يتم العثور على الشهيد أو لا تملك صلاحية الوصول إليه." }, env);
            return;
        }

        const userInfo = callbackQuery.from;

        if (action === 'edit') {
            // Check if there's already a pending edit request for this martyr
            const existingPendingRequest = await getPendingRequestByTargetId(originalMartyr.id, env);
            if (existingPendingRequest) {
                await sendTelegramMessage(chatId, { text: `يوجد طلب ${existingPendingRequest.type} قيد المراجعة بالفعل لهذا الشهيد.` }, env);
                return;
            }
            await startUploadProcess(chatId, userId, userInfo, env, originalMartyr, false); // originalRequest is a martyr here
        } else if (action === 'delete') {
            // Check if there's already a pending delete request for this martyr
            const existingPendingRequest = await getPendingRequestByTargetId(originalMartyr.id, env);
            if (existingPendingRequest) {
                await sendTelegramMessage(chatId, { text: `يوجد طلب ${existingPendingRequest.type} قيد المراجعة بالفعل بالفعل لهذا الشهيد.` }, env);
                return;
            }
            const success = await createDeleteRequest(userId, originalMartyr, env);
            const message = success ? `تم إرسال طلب لحذف الشهيد \"<b>${originalMartyr.full_name}</b>\".` : "حدث خطأ أثناء إنشاء طلب الحذف.";
            await sendTelegramMessage(chatId, { text: message }, env);
        }
        return; // Important: return after handling martyr actions
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
        const message = success ? `تم إرسال طلب لحذف الشهيد \"<b>${originalRequest.full_name}</b>\".` : "حدث خطأ أثناء إنشاء طلب الحذف.";
        await sendTelegramMessage(chatId, { text: message }, env);
    } else if (action === 'edit') {
        await startUploadProcess(chatId, userId, userInfo, env, originalRequest, false);
    }
}
