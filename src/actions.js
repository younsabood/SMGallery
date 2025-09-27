import { sendTelegramMessage, uploadPhotoToImgbb } from './telegram.js';
import { getKeyboard, REQUEST_STATUS, REQUEST_TYPE, STATES, createMainKeyboard } from './ui.js';
import { saveUserSession, saveRequest, clearUserSession } from './database.js';

export async function showMyAdditions(chatId, userId, env) {
    try {
        const { results: approvedResults } = await env.DB.prepare(
            "SELECT id, full_name FROM martyrs WHERE telegram_id = ? ORDER BY created_at DESC"
        ).bind(userId).all();

        if (approvedResults && approvedResults.length > 0) {
            await sendTelegramMessage(chatId, { text: "<b>الشهداء الذين أضفتهم:</b>" }, env);

            for (const req of approvedResults) {
                const martyrName = req.full_name || 'غير محدد';
                const messageText = `<b>${martyrName}</b>`;
                await sendTelegramMessage(chatId, { text: messageText }, env);
            }
        } else {
             await sendTelegramMessage(chatId, {
                text: "لم تقم بإضافة أي شهيد حتى الآن.",
                replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
            }, env);
        }

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
        const { results: approvedResults } = await env.DB.prepare(
            'SELECT id, full_name FROM submission_requests WHERE user_id = ? AND status = ? ORDER BY created_at DESC'
        ).bind(userId, REQUEST_STATUS.APPROVED).all();

        if (approvedResults && approvedResults.length > 0) {
            await sendTelegramMessage(chatId, { text: "<b>الشهداء الذين أضفتهم (مقبولين):</b>\n\nيمكنك طلب تعديل بياناتهم أو حذفهم." }, env);

            for (const req of approvedResults) {
                const martyrName = req.full_name || 'غير محدد';
                const messageText = `<b>${martyrName}</b>\n\nاختر الإجراء الذي تريده:`;
                const inlineKeyboard = {
                    inline_keyboard: [[
                        { text: '✏️ تعديل', callback_data: `edit_${req.id}` },
                        { text: '🗑️ حذف', callback_data: `delete_${req.id}` }
                    ]]
                };
                await sendTelegramMessage(chatId, { text: messageText, replyMarkup: inlineKeyboard }, env);
            }
        }

        const { results: pendingResults } = await env.DB.prepare(
            'SELECT full_name, status, type FROM submission_requests WHERE user_id = ? AND status != ? ORDER BY created_at DESC'
        ).bind(userId, REQUEST_STATUS.APPROVED).all();


        if (pendingResults && pendingResults.length > 0) {
            let requestsText = "<b>طلباتك قيد المراجعة أو المرفوضة:</b>\n\n";
            for (const req of pendingResults) {
                const statusEmoji = req.status === REQUEST_STATUS.PENDING ? '⏳' : '❌';
                const statusText = req.status === REQUEST_STATUS.PENDING ? 'قيد المراجعة' : 'تم الرفض';
                let typeText = '';
                switch (req.type) {
                    case REQUEST_TYPE.ADD: typeText = 'إضافة'; break;
                    case REQUEST_TYPE.EDIT: typeText = 'تعديل'; break;
                    case REQUEST_TYPE.DELETE: typeText = 'حذف'; break;
                }
                requestsText += `${statusEmoji} <b>${req.full_name}</b> (طلب ${typeText})\n   الحالة: ${statusText}\n\n`;
            }
            await sendTelegramMessage(chatId, { text: requestsText }, env);
        }

        if ((!approvedResults || approvedResults.length === 0) && (!pendingResults || pendingResults.length === 0)) {
             await sendTelegramMessage(chatId, {
                text: "لا توجد طلبات مقدمة من قبلك حتى الآن",
                replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
            }, env);
        }

    } catch (error) {
        console.error('Error showing user requests:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض طلباتك",
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
    }
}

export async function startUploadProcess(chatId, userId, userInfo, env, originalRequest = null) {
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
    const requestType = isEditing ? REQUEST_TYPE.EDIT : REQUEST_TYPE.ADD;
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
        // If editing and skipping photo, keep the old image URL
        const { results } = await env.DB.prepare('SELECT image_url FROM submission_requests WHERE id = ?').bind(targetId).all();
        if (results && results.length > 0) {
            imgbbUrl = results[0].image_url;
        }
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

    const requestId = await saveRequest(userId, requestData, env, requestType, targetId);

    if (requestId) {
        await clearUserSession(userId, env);

        const actionText = isEditing ? "تعديل" : "إضافة";
        const messageSummary = `تم إرسال طلب ${actionText} بنجاح!\n\n<b>ملخص البيانات:</b>\nالاسم: ${fullName}\nالعمر: ${martyrData.age || 'غير متوفر'}\nالولادة: ${martyrData.birth_date || 'غير متوفر'}\nالاستشهاد: ${martyrData.martyrdom_date || 'غير متوفر'}\nالمكان: ${martyrData.place || 'غير متوفر'}\n\nسيتم مراجعة طلبك من قبل الإدارة.`;

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



