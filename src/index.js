// src/index.js - Cloudflare Worker for Syrian Martyrs Bot (Updated for D1)

// States
const STATES = {
    IDLE: 'idle',
    WAITING_FIRST_NAME: 'waiting_first_name',
    WAITING_FATHER_NAME: 'waiting_father_name',
    WAITING_FAMILY_NAME: 'waiting_family_name',
    WAITING_AGE: 'waiting_age',
    WAITING_BIRTH_DATE: 'waiting_birth_date',
    WAITING_MARTYRDOM_DATE: 'waiting_martyrdom_date',
    WAITING_PLACE: 'waiting_place',
    WAITING_PHOTO: 'waiting_photo'
};

// Status Types
const REQUEST_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected'
};

// Request Types
const REQUEST_TYPE = {
    ADD: 'add',
    EDIT: 'edit',
    DELETE: 'delete'
};


// Utility Functions
function generateRequestId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function getKeyboard(buttons) {
    return {
        keyboard: buttons.map(btn => [{ text: btn }]),
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

// Telegram API interactions
async function sendTelegramMessage(chatId, options = {}, env) {
    const { text, replyMarkup, photoId, photoCaption } = options;
    const BOT_TOKEN = env.BOT_TOKEN;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/`;

    let url = TELEGRAM_API_URL;
    let payload = {
        chat_id: chatId,
        parse_mode: 'HTML'
    };

    if (photoId) {
        url += "sendPhoto";
        payload.photo = photoId;
        if (photoCaption) {
            payload.caption = photoCaption;
        }
    } else {
        url += "sendMessage";
        payload.text = text || "رسالة فارغة";
    }

    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
        }
        console.log(`Message sent successfully to chat ${chatId}`);
    } catch (error) {
        console.error(`Error sending message to chat ${chatId}:`, error.message);
    }
}


async function answerCallbackQuery(callbackQueryId, env, text = '') {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
    await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            callback_query_id: callbackQueryId,
            text: text
        }),
    });
}


async function getTelegramPhotoUrl(fileId, env) {
    const BOT_TOKEN = env.BOT_TOKEN;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/`;

    try {
        const response = await fetch(`${TELEGRAM_API_URL}getFile?file_id=${fileId}`);
        const data = await response.json();
        if (data.ok && data.result && data.result.file_path) {
            const filePath = data.result.file_path;
            return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        } else {
            console.error('Telegram API getFile failed:', data.description);
            return null;
        }
    } catch (error) {
        console.error('Error getting Telegram file path:', error.message);
        return null;
    }
}

async function uploadPhotoToImgbb(fileId, env) {
    const IMGBB_API_KEY = env.IMGBB_API_KEY;
    try {
        const fileUrl = await getTelegramPhotoUrl(fileId, env);
        if (!fileUrl) {
            console.error('Could not get Telegram file URL.');
            return null;
        }

        const imageResponse = await fetch(fileUrl);
        const imageBlob = await imageResponse.blob();

        const formData = new FormData();
        formData.append('key', IMGBB_API_KEY);
        formData.append('image', imageBlob);

        const response = await fetch('https://api.imgbb.com/1/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();
        if (data.success) {
            console.log('Photo uploaded to imgbb successfully.');
            return data.data.url;
        } else {
            console.error('imgbb upload failed:', data.error.message);
            return null;
        }
    } catch (error) {
        console.error('Error uploading photo to imgbb:', error.message);
        return null;
    }
}

// Session Management with D1
async function saveUserSession(userId, sessionData, env) {
    try {
        await env.DB.prepare(
            'INSERT OR REPLACE INTO sessions (user_id, state, data, user_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
            userId,
            sessionData.state,
            JSON.stringify(sessionData), // Save the whole session object in data
            JSON.stringify(sessionData.userInfo),
            new Date().toISOString(),
            new Date().toISOString()
        ).run();
        console.log(`Session saved for user ${userId} using D1.`);
        return true;
    } catch (error) {
        console.error(`Error saving session for user ${userId}:`, error.message);
        return false;
    }
}


async function getUserSession(userId, env) {
    try {
        const result = await env.DB.prepare('SELECT data FROM sessions WHERE user_id = ?').bind(userId).first();
        if (result && result.data) {
            const session = JSON.parse(result.data);
            console.log(`Session retrieved for user ${userId}. State: ${session.state}`);
            return session;
        }
    } catch (error) {
        console.error(`Error retrieving session for user ${userId}:`, error.message);
    }
    console.log(`No session found for user ${userId}.`);
    return {
        state: STATES.IDLE,
        data: {},
        userInfo: {}
    };
}


async function clearUserSession(userId, env) {
    try {
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
        console.log(`Session cleared for user ${userId} from D1.`);
        return true;
    } catch (error) {
        console.error(`Error clearing session for user ${userId}:`, error.message);
        return false;
    }
}

// Request Management with D1
async function saveRequest(userId, requestData, env, type = REQUEST_TYPE.ADD, targetId = null) {
    try {
        const result = await env.DB.prepare(
            `INSERT INTO submission_requests (id, user_id, full_name, name_first, name_father, name_family, age, date_birth, date_martyrdom, place, image_url, status, type, target_martyr_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            generateRequestId(),
            userId,
            requestData.martyrData.full_name,
            requestData.martyrData.name_first,
            requestData.martyrData.name_father,
            requestData.martyrData.name_family,
            requestData.martyrData.age,
            requestData.martyrData.date_birth,
            requestData.martyrData.date_martyrdom,
            requestData.martyrData.place,
            requestData.martyrData.imageUrl,
            REQUEST_STATUS.PENDING,
            type,
            targetId,
            new Date().toISOString()
        ).run();

        console.log(`Request saved with ID: ${result.meta.last_row_id}`);
        return result.meta.last_row_id;
    } catch (error) {
        console.error(`Error saving request:`, error.message);
        return null;
    }
}


async function createDeleteRequest(userId, originalRequest, env) {
    try {
        await env.DB.prepare(
            `INSERT INTO submission_requests (id, user_id, full_name, name_first, name_father, name_family, age, date_birth, date_martyrdom, place, image_url, status, type, target_martyr_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            generateRequestId(),
            userId,
            originalRequest.full_name,
            originalRequest.name_first,
            originalRequest.name_father,
            originalRequest.name_family,
            originalRequest.age,
            originalRequest.date_birth,
            originalRequest.date_martyrdom,
            originalRequest.place,
            originalRequest.image_url,
            REQUEST_STATUS.PENDING,
            REQUEST_TYPE.DELETE,
            originalRequest.id, // target_martyr_id is the id of the request being deleted
            new Date().toISOString()
        ).run();
        console.log(`Delete request created for martyr ID: ${originalRequest.id}`);
        return true;
    } catch (error) {
        console.error('Error creating delete request:', error);
        return false;
    }
}


async function showUserRequests(chatId, userId, env) {
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
                replyMarkup: getKeyboard(['إضافة شهيد جديد', 'مساعدة'])
            }, env);
        }

    } catch (error) {
        console.error('Error showing user requests:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض طلباتك",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        }, env);
    }
}

// Bot Logic Handlers
async function handleTextMessage(chatId, userId, text, userInfo, env) {
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
• المساعدة

لبدء إضافة شهيد جديد، اضغط على <b>إضافة شهيد جديد</b>`;

        await sendTelegramMessage(chatId, {
            text: welcomeText,
            replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي', 'مساعدة'])
        }, env);
        return;
    }

    if (text === 'إضافة شهيد جديد' || text === '/upload') {
        await startUploadProcess(chatId, userId, userInfo, env);
    } else if (text === 'مساعدة' || text === '/help') {
        await showHelp(chatId, env);
    } else if (text === 'عرض طلباتي' || text === '/my_requests') {
        await showUserRequests(chatId, userId, env);
    } else if (text === 'إلغاء' || text === '/cancel') {
        await clearUserSession(userId, env);
        await sendTelegramMessage(chatId, {
            text: "تم إلغاء العملية الحالية\n\nيمكنك البدء من جديد",
            replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي', 'مساعدة'])
        }, env);
    } else {
        await handleUserInput(chatId, userId, text, env);
    }
}

async function startUploadProcess(chatId, userId, userInfo, env, originalRequest = null) {
    console.log(`Starting process for user ${userId}. Is editing: ${!!originalRequest}`);
    const isEditing = !!originalRequest;

    const sessionData = {
        state: STATES.WAITING_FIRST_NAME,
        data: isEditing ? {
            first_name: originalRequest.name_first,
            father_name: originalRequest.name_father,
            family_name: originalRequest.name_family,
            age: originalRequest.age,
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
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        }, env);
    }
}


async function showHelp(chatId, env) {
    const helpText = `مساعدة بوت معرض شهداء الساحل السوري

<b>إضافة شهيد جديد:</b>
يمكنك إضافة شهيد جديد باتباع الخطوات المطلوبة

<b>عرض طلباتي:</b>
يمكنك مشاهدة حالة جميع طلباتك المقدمة، وطلب تعديل أو حذف المقبول منها.

للمساعدة الإضافية، تواصل مع المدير: @DevYouns`;

    await sendTelegramMessage(chatId, {
        text: helpText,
        replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
    }, env);
}

async function handleUserInput(chatId, userId, text, env) {
    const session = await getUserSession(userId, env);
    console.log(`User ${userId} input: "${text}" with session state: ${session.state}`);

    if (session.state === STATES.IDLE) {
        await sendTelegramMessage(chatId, {
            text: "لا توجد عملية جارية. استخدم <b>إضافة شهيد جديد</b> لبدء الإضافة",
            replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
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
            session.state = STATES.WAITING_AGE;
            await sendTelegramMessage(chatId, {
                text: `الرجاء إدخال عمر الشهيد: ${isEditing ? `(الحالي: ${session.data.age})` : ''}`,
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_AGE:
            const age = parseInt(text);
            if (isNaN(age) || age < 0 || age > 150) {
                await sendTelegramMessage(chatId, { text: "الرجاء إدخال عمر صحيح (0-150)" }, env);
                return;
            }
            sessionData.age = age;
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

async function handlePhotoMessage(chatId, userId, photoData, caption = '', env) {
    console.log(`Handling photo message from user ${userId}.`);
    const session = await getUserSession(userId, env);

    if (session.state !== STATES.WAITING_PHOTO) {
        await sendTelegramMessage(chatId, {
            text: "يرجى اتباع الخطوات بالترتيب\n\nاستخدم <b>إضافة شهيد جديد</b> لبدء الإضافة",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        }, env);
        return;
    }

    const photo = photoData[photoData.length - 1];
    const photoFileId = photo.file_id;
    session.data.photo_file_id = photoFileId;
    session.data.photo_caption = caption;

    await completeRequest(chatId, userId, session, env);
}

async function completeRequest(chatId, userId, session, env, skipPhoto = false) {
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
        const messageSummary = `تم إرسال طلب ${actionText} بنجاح!

<b>ملخص البيانات:</b>
الاسم: ${fullName}
العمر: ${martyrData.age || 'غير متوفر'}
الولادة: ${martyrData.birth_date || 'غير متوفر'}
الاستشهاد: ${martyrData.martyrdom_date || 'غير متوفر'}
المكان: ${martyrData.place || 'غير متوفر'}

سيتم مراجعة طلبك من قبل الإدارة.`;

        if (!skipPhoto && martyrData.photo_file_id) {
            await sendTelegramMessage(chatId, {
                photoCaption: messageSummary,
                photoId: martyrData.photo_file_id,
                replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
            }, env);
        } else {
            await sendTelegramMessage(chatId, {
                text: messageSummary,
                replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
            }, env);
        }
    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        }, env);
    }
}


async function handleCallbackQuery(chatId, userId, callbackQuery, env) {
    const [action, requestId] = callbackQuery.data.split('_');

    await answerCallbackQuery(callbackQuery.id, env, 'جاري معالجة طلبك...');

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


    if (action === 'delete') {
        const success = await createDeleteRequest(userId, originalRequest, env);
        if (success) {
            await sendTelegramMessage(chatId, { text: `تم إرسال طلب لحذف الشهيد "<b>${originalRequest.full_name}</b>". سيتم مراجعته من قبل الإدارة.` }, env);
        } else {
            await sendTelegramMessage(chatId, { text: "حدث خطأ أثناء إنشاء طلب الحذف." }, env);
        }
    } else if (action === 'edit') {
        await startUploadProcess(chatId, userId, userInfo, originalRequest);
    }
}


// Main handler
async function handleRequest(request, env) {
    if (request.method === 'POST') {
        try {
            const update = await request.json();
            console.log('Received update from Telegram');

            if (update.message) {
                const message = update.message;
                const chatId = message.chat.id;
                const userId = message.from.id.toString();

                const userInfo = {
                    telegram_id: userId,
                    first_name: message.from.first_name || '',
                    last_name: message.from.last_name || '',
                    username: message.from.username || ''
                };

                if (message.text) {
                    await handleTextMessage(chatId, userId, message.text, userInfo, env);
                } else if (message.photo) {
                    const caption = message.caption || '';
                    await handlePhotoMessage(chatId, userId, message.photo, caption, env);
                } else {
                    await sendTelegramMessage(chatId, {
                        text: "نوع الرسالة غير مدعوم. يرجى إرسال نص أو صورة فقط."
                    }, env);
                }
            } else if (update.callback_query) {
                const callbackQuery = update.callback_query;
                const chatId = callbackQuery.message.chat.id;
                const userId = callbackQuery.from.id.toString();
                await handleCallbackQuery(chatId, userId, callbackQuery, env);
            } else {
                console.log('Received unsupported update type.');
            }

            return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });

        } catch (error) {
            console.error('Error processing webhook:', error);
            return new Response(JSON.stringify({
                status: 'error',
                message: 'Internal error occurred',
                error: error.message
            }), { status: 500 });
        }
    } else if (request.method === 'GET') {
        return new Response(JSON.stringify({
            "status": "ok",
            "message": "Syrian Martyrs Bot is running on Cloudflare Workers!",
            "platform": "Cloudflare Workers"
        }), { status: 200 });
    }

    return new Response(JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { status: 405 });
}

// Export the handler for Cloudflare Workers
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    },
};
