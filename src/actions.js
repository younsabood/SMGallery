import { sendTelegramMessage, uploadPhotoToImgbb } from './telegram.js';
import { getKeyboard, REQUEST_STATUS, REQUEST_TYPE, STATES, createMainKeyboard } from './ui.js';
import { saveUserSession, saveRequest, clearUserSession, deleteRequest, updateRequest } from './database.js';

export async function showMyAdditions(chatId, userId, env) {
    try {
        // Select from the final martyrs table as requested by the user
        const { results: martyrs } = await env.DB.prepare(
            "SELECT * FROM martyrs WHERE telegram_id = ? ORDER BY created_at DESC"
        ).bind(userId).all();

        if (martyrs && martyrs.length > 0) {
            await sendTelegramMessage(chatId, { text: "<b>الشهداء الذين أضفتهم:</b>" }, env);

            for (const martyr of martyrs) {
                const caption = `
<b>الاسم الكامل:</b> ${martyr.full_name || 'غير متوفر'}
<b>العمر عند الاستشهاد:</b> ${martyr.age || 'غير متوفر'}
<b>تاريخ الولادة:</b> ${martyr.date_birth || 'غير متوفر'}
<b>تاريخ الاستشهاد:</b> ${martyr.date_martyrdom || 'غير متوفر'}
<b>مكان الاستشهاد:</b> ${martyr.place || 'غير متوفر'}
                `.trim();

                // Use the submission_id from the martyrs table for the callback
                // This assumes the 'submission_id' column exists and links back to the submission_requests table
                const submissionId = martyr.submission_id;
                let inlineKeyboard;

                if (submissionId) {
                    inlineKeyboard = {
                        inline_keyboard: [[
                            { text: '✏️ تعديل', callback_data: `edit_${submissionId}` },
                            { text: '🗑️ حذف', callback_data: `delete_${submissionId}` }
                        ]]
                    };
                }

                if (martyr.image_url) {
                    await sendTelegramMessage(chatId, {
                        photoId: martyr.image_url,
                        photoCaption: caption,
                        replyMarkup: inlineKeyboard // Will be undefined if no submissionId, which is fine
                    }, env);
                } else {
                    await sendTelegramMessage(chatId, { text: caption, replyMarkup: inlineKeyboard }, env);
                }
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
        const { results: pendingRequests } = await env.DB.prepare(
            "SELECT * FROM submission_requests WHERE user_id = ? AND status = ? ORDER BY created_at DESC"
        ).bind(userId, REQUEST_STATUS.PENDING).all();

        if (pendingRequests && pendingRequests.length > 0) {
            await sendTelegramMessage(chatId, { text: "<b>طلباتك قيد المراجعة:</b>" }, env);
            for (const req of pendingRequests) {
                let requestText = `⏳ <b>${req.full_name}</b> (طلب ${req.type})\n   الحالة: قيد المراجعة`;
                const inlineKeyboard = {
                    inline_keyboard: [[
                        { text: '✏️ تعديل', callback_data: `pending_edit_${req.id}` },
                        { text: '🗑️ حذف', callback_data: `pending_delete_${req.id}` }
                    ]]
                };
                await sendTelegramMessage(chatId, { text: requestText, replyMarkup: inlineKeyboard }, env);
            }
        }

        const { results: rejectedRequests } = await env.DB.prepare(
            "SELECT * FROM submission_requests WHERE user_id = ? AND status = ? ORDER BY created_at DESC"
        ).bind(userId, REQUEST_STATUS.REJECTED).all();

        if (rejectedRequests && rejectedRequests.length > 0) {
            await sendTelegramMessage(chatId, { text: "<b>طلباتك المرفوضة:</b>" }, env);
            for (const req of rejectedRequests) {
                let requestText = `❌ <b>${req.full_name}</b> (طلب ${req.type})\n   الحالة: تم الرفض`;
                const inlineKeyboard = {
                    inline_keyboard: [[
                        { text: '🗑️ حذف', callback_data: `rejected_delete_${req.id}` }
                    ]]
                };
                await sendTelegramMessage(chatId, { text: requestText, replyMarkup: inlineKeyboard }, env);
            }
        }

        if ((!pendingRequests || pendingRequests.length === 0) && (!rejectedRequests || rejectedRequests.length === 0)) {
             await sendTelegramMessage(chatId, {
                text: "لا توجد طلبات قيد المراجعة أو مرفوضة.",
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



