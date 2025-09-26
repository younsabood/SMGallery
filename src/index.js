// src/index.js - Cloudflare Worker for Syrian Martyrs User Bot

// --- State Machine ---
const STATES = {
    IDLE: 'idle',
    // Add flow
    WAITING_FIRST_NAME: 'waiting_first_name',
    WAITING_FATHER_NAME: 'waiting_father_name',
    WAITING_FAMILY_NAME: 'waiting_family_name',
    WAITING_AGE: 'waiting_age',
    WAITING_MARTYRDOM_DATE: 'waiting_martyrdom_date',
    WAITING_PLACE: 'waiting_place',
    WAITING_PHOTO: 'waiting_photo',
    // Edit flow states
    EDITING_FIELD: 'editing_field',
};

// --- Request Types ---
const REQUEST_TYPE = {
    ADD: 'add',
    EDIT: 'edit',
    DELETE: 'delete'
};

// =================================================================================
// Utility Functions
// =================================================================================

function getKeyboard(buttons) {
    return {
        keyboard: buttons.map(btn => [{ text: btn }]),
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

async function sendTelegramMessage(chatId, options = {}, env) {
    const { text, replyMarkup, photoId } = options;
    const BOT_TOKEN = env.BOT_TOKEN;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/`;

    let url = `${TELEGRAM_API_URL}sendMessage`;
    let payload = {
        chat_id: String(chatId),
        text: text || "رسالة فارغة",
        parse_mode: 'HTML',
    };

    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            console.error(`Error sending message: ${await response.text()}`);
        }
    } catch (error) {
        console.error('Error sending message to Telegram:', error);
    }
}


// =================================================================================
// Session and Data Management
// =================================================================================

async function getUserSession(userId, env) {
    return await env.DB.prepare('SELECT * FROM user_sessions WHERE user_id = ?').bind(userId).first() || null;
}

async function createOrUpdateSession(userId, state, data = '{}', env) {
    const now = new Date().toISOString();
    await env.DB.prepare(
        `INSERT INTO user_sessions (user_id, state, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = excluded.updated_at`
    ).bind(userId, state, data, now, now).run();
}

async function deleteUserSession(userId, env) {
    await env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run();
}

async function createSubmissionRequest(userId, type, data, targetMartyrId = null, env) {
    const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();
    const dataJson = JSON.stringify(data);

    await env.DB.prepare(
        `INSERT INTO submission_requests (id, user_id, type, status, data, target_martyr_id, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).bind(requestId, userId, type, dataJson, targetMartyrId, now, now).run();
}

// =================================================================================
// Bot Main Logic
// =================================================================================

async function showMainMenu(chatId, env) {
    await sendTelegramMessage(chatId, {
        text: 'أهلاً بك في بوت معرض شهداء سوريا. يرجى اختيار أحد الخيارات:',
        replyMarkup: getKeyboard(['➕ إضافة شهيد', '📂 عرض طلباتي'])
    }, env);
}

async function showUserSubmissions(chatId, userId, env) {
    await sendTelegramMessage(chatId, { text: '⏳ جاري البحث عن طلباتك السابقة...' }, env);

    const { results } = await env.DB.prepare(
        // We select requests that this user submitted and were approved
        `SELECT id, data FROM martyrs WHERE id IN (SELECT id FROM submission_requests WHERE user_id = ?)`
    ).bind(userId).all();

    if (!results || results.length === 0) {
        await sendTelegramMessage(chatId, { text: 'لم يتم العثور على أي مساهمات مقبولة باسمك.' }, env);
        await showMainMenu(chatId, env);
        return;
    }

    await sendTelegramMessage(chatId, { text: `تم العثور على ${results.length} مساهمة مقبولة. سيتم عرضها الآن:` }, env);

    for (const martyr of results) {
        const message = `<b>الاسم:</b> ${martyr.full_name}\n<b>مكان الاستشهاد:</b> ${martyr.place}`;

        const buttons = [
            { text: '✏️ تعديل', callback_data: `edit_${martyr.id}` },
            { text: '🗑️ حذف', callback_data: `delete_${martyr.id}` }
        ];

        await sendTelegramMessage(chatId, {
            text: message,
            replyMarkup: { inline_keyboard: [buttons] }
        }, env);
    }
}

async function startAddProcess(chatId, userId, env) {
    await createOrUpdateSession(userId, STATES.WAITING_FIRST_NAME, '{}', env);
    await sendTelegramMessage(chatId, { text: 'لنبدأ عملية إضافة الشهيد. لطفاً، أدخل الاسم الأول للشهيد:' }, env);
}

async function handleTextMessage(chatId, userId, text, env) {
    const session = await getUserSession(userId, env);
    const state = session?.state || STATES.IDLE;
    const data = session ? JSON.parse(session.data) : {};

    if (text === '/start' || text === 'العودة للقائمة الرئيسية') {
        await deleteUserSession(userId, env);
        await showMainMenu(chatId, env);
        return;
    }
    if (text === '➕ إضافة شهيد') {
        await startAddProcess(chatId, userId, env);
        return;
    }
    if (text === '📂 عرض طلباتي') {
        await showUserSubmissions(chatId, userId, env);
        return;
    }

    let nextState = state;
    let responseText = 'حدث خطأ غير متوقع.';

    switch (state) {
        case STATES.WAITING_FIRST_NAME:
            data.name_first = text;
            nextState = STATES.WAITING_FATHER_NAME;
            responseText = 'شكراً. الآن أدخل اسم الأب:';
            break;
        case STATES.WAITING_FATHER_NAME:
            data.name_father = text;
            nextState = STATES.WAITING_FAMILY_NAME;
            responseText = 'شكراً. الآن أدخل الكنية:';
            break;
        case STATES.WAITING_FAMILY_NAME:
            data.name_family = text;
            data.full_name = `${data.name_first} ${data.name_father} ${data.name_family}`;
            nextState = STATES.WAITING_AGE;
            responseText = 'شكراً. الآن أدخل عمر الشهيد (رقم فقط):';
            break;
        case STATES.WAITING_AGE:
            const age = parseInt(text, 10);
            if (isNaN(age) || age < 0 || age > 150) {
                responseText = 'يرجى إدخال عمر صحيح (رقم بين 0 و 150).';
            } else {
                data.age = age;
                nextState = STATES.WAITING_MARTYRDOM_DATE;
                responseText = 'شكراً. الآن أدخل تاريخ الاستشهاد (مثال: 2015-05-22):';
            }
            break;
        case STATES.WAITING_MARTYRDOM_DATE:
            data.date_martyrdom = text;
            nextState = STATES.WAITING_PLACE;
            responseText = 'شكراً. الآن أدخل مكان الاستشهاد:';
            break;
        case STATES.WAITING_PLACE:
            data.place = text;
            nextState = STATES.WAITING_PHOTO;
            responseText = 'الخطوة الأخيرة: يرجى إرسال صورة واضحة للشهيد.';
            break;
        case STATES.EDITING_FIELD:
            data.new_value = text;
            await createSubmissionRequest(userId, REQUEST_TYPE.EDIT, data, data.target_martyr_id, env);
            await deleteUserSession(userId, env);
            await sendTelegramMessage(chatId, { text: '✅ تم إرسال طلب التعديل بنجاح للمراجعة.'}, env);
            await showMainMenu(chatId, env);
            return;
    }

    if (nextState !== state) {
        await createOrUpdateSession(userId, nextState, JSON.stringify(data), env);
    }
    await sendTelegramMessage(chatId, { text: responseText }, env);
}

async function handlePhotoMessage(chatId, userId, photo, env) {
    const session = await getUserSession(userId, env);
    if (session?.state !== STATES.WAITING_PHOTO) return;

    const data = JSON.parse(session.data);
    const fileId = photo[photo.length - 1].file_id;

    await sendTelegramMessage(chatId, { text: '⏳ جاري رفع الصورة وتجهيز الطلب...' }, env);
    const getFileResponse = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileResult = await getFileResponse.json();
    if (!fileResult.ok) throw new Error('Failed to get file path from Telegram.');

    const photoUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileResult.result.file_path}`;
    const uploadResponse = await fetch(`https://api.imgbb.com/1/upload?key=${env.IMGBB_API_KEY}&image=${encodeURIComponent(photoUrl)}`);
    const uploadResult = await uploadResponse.json();
    if (!uploadResult.success) throw new Error('Failed to upload image to ImgBB.');

    data.image_url = uploadResult.data.url;

    await createSubmissionRequest(userId, REQUEST_TYPE.ADD, data, null, env);
    await deleteUserSession(userId, env);
    await sendTelegramMessage(chatId, { text: '✅ شكراً جزيلاً لك! تم إرسال طلبك بنجاح وستتم مراجعته.' }, env);
    await showMainMenu(chatId, env);
}

async function handleCallbackQuery(chatId, userId, callbackQuery, env) {
    const data = callbackQuery.data;
    const [action, targetId] = data.split('_');

    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    });

    if (action === 'delete') {
        const requestData = { message: "User requested deletion." };
        await createSubmissionRequest(userId, REQUEST_TYPE.DELETE, requestData, targetId, env);
        await sendTelegramMessage(chatId, { text: '✅ تم إرسال طلب الحذف بنجاح للمراجعة.' }, env);
    } else if (action === 'edit') {
        const fieldsToEdit = [
            { text: 'الاسم الكامل', callback_data: `editfield_full_name_${targetId}` },
            { text: 'العمر', callback_data: `editfield_age_${targetId}` },
            { text: 'مكان الاستشهاد', callback_data: `editfield_place_${targetId}` },
        ];
        await sendTelegramMessage(chatId, {
            text: 'أي حقل تود تعديله؟',
            replyMarkup: { inline_keyboard: [fieldsToEdit] }
        }, env);
    } else if (action === 'editfield') {
        const [_, field, targetMartyrId] = data.split('_');
        const sessionData = {
            target_martyr_id: targetMartyrId,
            field_to_edit: field
        };
        await createOrUpdateSession(userId, STATES.EDITING_FIELD, JSON.stringify(sessionData), env);
        await sendTelegramMessage(chatId, { text: `يرجى إدخال القيمة الجديدة لحقل "${field}":` }, env);
    }
}

// Main Fetch Handler
export default {
    async fetch(request, env, ctx) {
        if (request.method === 'POST') {
            try {
                const update = await request.json();

                if (update.message) {
                    const { message } = update;
                    const chatId = message.chat.id;
                    const userId = message.from.id.toString();

                    if (message.text) {
                        await handleTextMessage(chatId, userId, message.text, env);
                    } else if (message.photo) {
                        await handlePhotoMessage(chatId, userId, message.photo, env);
                    }
                } else if (update.callback_query) {
                    const { callback_query } = update;
                    const chatId = callback_query.message.chat.id;
                    const userId = callback_query.from.id.toString();
                    await handleCallbackQuery(chatId, userId, callback_query, env);
                }
            } catch (error) {
                console.error('Error processing webhook:', error);
            }
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    },
};

