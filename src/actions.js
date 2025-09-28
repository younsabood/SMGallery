import { sendTelegramMessage, uploadPhotoToImgbb } from './telegram.js';
import { getKeyboard, REQUEST_STATUS, REQUEST_TYPE, STATES, createMainKeyboard, displayItems } from './ui.js';
import { 
    saveUserSession, 
    saveRequest, 
    clearUserSession, 
    updateRequest, 
    getUserAdditions, 
    getUserRequestsByStatus, 
    getSubmissionImageUrl 
} from './database.js';

/**
 * Formats a martyr record for display.
 * @param {object} martyr - The martyr record from the database.
 * @returns {{caption: string, inlineKeyboard: object}} - The formatted caption and keyboard.
 */
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

/**
 * Formats a pending submission request for display.
 * @param {object} req - The request record from the database.
 * @returns {{caption: string, inlineKeyboard: object}} - The formatted caption and keyboard.
 */
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

/**
 * Formats a rejected submission request for display.
 * @param {object} req - The request record from the database.
 * @returns {{caption: string, inlineKeyboard: object}} - The formatted caption and keyboard.
 */
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

export async function showMyAdditions(chatId, userId, env) {
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

export async function showUserRequests(chatId, userId, env) {
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

export async function startUploadProcess(chatId, userId, userInfo, env, originalRequest = null, isPendingEdit = false) {
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


export async function showHelp(chatId, env) {
    const helpText = `مساعدة بوت معرض شهداء الساحل السوري

<b>إضافة شهيد جديد:</b>
يمكنك إضافة شهيد جديد باتباع الخطوات المطلوبة

<b>عرض طلباتي:</b>
يمكنك مشاهدة حالة جميع طلباتك المقدمة، وطلب تعديل أو حذف المقبول منها.

للمساعدة الإضافية، تواصل مع المدير: @DevYouns`;

    await sendTelegramMessage(chatId, {
        text: helpText,
        replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
    }, env);
}

export async function completeRequest(chatId, userId, session, env, skipPhoto = false) {
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