// src/index.js - Cloudflare Worker for Syrian Martyrs Bot (Updated)

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

// KV Keys Schema - مفاتيح قاعدة البيانات المشتركة
const KV_KEYS = {
    // User sessions
    SESSION: (userId) => `session:${userId}`,
    
    // Requests by status
    PENDING_REQUESTS: () => `requests:pending`,
    APPROVED_REQUESTS: () => `requests:approved`,
    
    // Individual request data
    REQUEST: (requestId) => `request:${requestId}`,
    
    // User's request IDs
    USER_REQUESTS: (userId) => `user_requests:${userId}`,
    
    // Martyrs database
    MARTYRS: () => `martyrs`,
    
    // System statistics
    SYSTEM_STATS: () => `system_stats`,
    
    // Admin sessions
    ADMIN_SESSION: (userId) => `admin_session:${userId}`,
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

// System Statistics Manager
class SystemStats {
    static async get(env) {
        try {
            const statsString = await env.BOT_DATA.get(KV_KEYS.SYSTEM_STATS());
            return statsString ? JSON.parse(statsString) : {
                totalRequests: 0,
                pendingRequests: 0,
                approvedRequests: 0,
                rejectedRequests: 0,
                totalMartyrs: 0,
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting system stats:', error);
            return null;
        }
    }

    static async update(env, changes) {
        try {
            const stats = await this.get(env);
            if (!stats) return false;

            // Apply changes
            Object.keys(changes).forEach(key => {
                if (key in stats) {
                    stats[key] += changes[key];
                    if (stats[key] < 0) stats[key] = 0; // Prevent negative values
                }
            });

            stats.lastUpdated = new Date().toISOString();
            await env.BOT_DATA.put(KV_KEYS.SYSTEM_STATS(), JSON.stringify(stats));
            console.log('System stats updated:', changes);
            return true;
        } catch (error) {
            console.error('Error updating system stats:', error);
            return false;
        }
    }

    static async increment(env, field, amount = 1) {
        const changes = { [field]: amount };
        return await this.update(env, changes);
    }

    static async decrement(env, field, amount = 1) {
        const changes = { [field]: -amount };
        return await this.update(env, changes);
    }
}

// Request Manager
class RequestManager {
    static async addToPendingList(requestId, env) {
        try {
            const pendingString = await env.BOT_DATA.get(KV_KEYS.PENDING_REQUESTS());
            let pendingList = pendingString ? JSON.parse(pendingString) : [];
            
            if (!pendingList.includes(requestId)) {
                pendingList.push(requestId);
                await env.BOT_DATA.put(KV_KEYS.PENDING_REQUESTS(), JSON.stringify(pendingList));
            }
            return true;
        } catch (error) {
            console.error('Error adding to pending list:', error);
            return false;
        }
    }

    static async removeFromPendingList(requestId, env) {
        try {
            const pendingString = await env.BOT_DATA.get(KV_KEYS.PENDING_REQUESTS());
            let pendingList = pendingString ? JSON.parse(pendingString) : [];
            
            pendingList = pendingList.filter(id => id !== requestId);
            await env.BOT_DATA.put(KV_KEYS.PENDING_REQUESTS(), JSON.stringify(pendingList));
            return true;
        } catch (error) {
            console.error('Error removing from pending list:', error);
            return false;
        }
    }

    static async addToApprovedList(requestId, env) {
        try {
            const approvedString = await env.BOT_DATA.get(KV_KEYS.APPROVED_REQUESTS());
            let approvedList = approvedString ? JSON.parse(approvedString) : [];
            
            if (!approvedList.includes(requestId)) {
                approvedList.push(requestId);
                await env.BOT_DATA.put(KV_KEYS.APPROVED_REQUESTS(), JSON.stringify(approvedList));
            }
            return true;
        } catch (error) {
            console.error('Error adding to approved list:', error);
            return false;
        }
    }

    static async getPendingRequests(env) {
        try {
            const pendingString = await env.BOT_DATA.get(KV_KEYS.PENDING_REQUESTS());
            return pendingString ? JSON.parse(pendingString) : [];
        } catch (error) {
            console.error('Error getting pending requests:', error);
            return [];
        }
    }

    static async getRequestData(requestId, env) {
        try {
            const requestString = await env.BOT_DATA.get(KV_KEYS.REQUEST(requestId));
            return requestString ? JSON.parse(requestString) : null;
        } catch (error) {
            console.error('Error getting request data:', error);
            return null;
        }
    }
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
        payload.reply_markup = replyMarkup;
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

        const formData = new FormData();
        formData.append('key', IMGBB_API_KEY);
        formData.append('image', fileUrl);

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

// Session Management
async function saveUserSession(userId, sessionData, env) {
    try {
        const sessionString = JSON.stringify(sessionData);
        await env.BOT_DATA.put(KV_KEYS.SESSION(userId), sessionString);
        console.log(`Session saved for user ${userId}.`);
        return true;
    } catch (error) {
        console.error(`Error saving session for user ${userId}:`, error.message);
        return false;
    }
}

async function getUserSession(userId, env) {
    try {
        const sessionString = await env.BOT_DATA.get(KV_KEYS.SESSION(userId));
        if (sessionString) {
            const session = JSON.parse(sessionString);
            console.log(`Session retrieved for user ${userId}. State: ${session.state}`);
            return session;
        }
    } catch (error) {
        console.error(`Error retrieving session for user ${userId}:`, error.message);
    }
    console.log(`No session found for user ${userId}.`);
    return { state: STATES.IDLE, data: {} };
}

async function clearUserSession(userId, env) {
    try {
        await env.BOT_DATA.delete(KV_KEYS.SESSION(userId));
        console.log(`Session cleared for user ${userId}.`);
        return true;
    } catch (error) {
        console.error(`Error clearing session for user ${userId}:`, error.message);
        return false;
    }
}

// Request Management
async function saveRequest(userId, requestData, env) {
    const requestId = generateRequestId();
    const requestKey = KV_KEYS.REQUEST(requestId);
    const userRequestsKey = KV_KEYS.USER_REQUESTS(userId);
    
    try {
        // Save the request itself
        const fullRequestData = {
            ...requestData,
            userId: userId,
            requestId: requestId,
            status: REQUEST_STATUS.PENDING,
            createdAt: new Date().toISOString()
        };
        
        await env.BOT_DATA.put(requestKey, JSON.stringify(fullRequestData));

        // Add to pending list
        await RequestManager.addToPendingList(requestId, env);

        // Update user's request list
        let userRequests = await env.BOT_DATA.get(userRequestsKey, 'json');
        if (!userRequests) {
            userRequests = [];
        }
        userRequests.push(requestId);
        await env.BOT_DATA.put(userRequestsKey, JSON.stringify(userRequests));

        // Update statistics
        await SystemStats.increment(env, 'totalRequests');
        await SystemStats.increment(env, 'pendingRequests');

        console.log(`Request saved: ${requestId}`);
        return requestId;
    } catch (error) {
        console.error(`Error saving request: ${requestId}`, error.message);
        return null;
    }
}

async function showUserRequests(chatId, userId, env) {
    try {
        const requestsIds = await env.BOT_DATA.get(KV_KEYS.USER_REQUESTS(userId), 'json');
        if (!requestsIds || !requestsIds.length) {
            await sendTelegramMessage(chatId, {
                text: "لا توجد طلبات مقدمة من قبلك حتى الآن",
                replyMarkup: getKeyboard(['إضافة شهيد جديد'])
            }, env);
            return;
        }

        const requests = await Promise.all(requestsIds.map(async (reqId) => {
            return await RequestManager.getRequestData(reqId, env);
        }));
        
        const validRequests = requests.filter(req => req !== null);
        if (validRequests.length === 0) {
            await sendTelegramMessage(chatId, {
                text: "لا توجد طلبات صالحة مقدمة من قبلك حتى الآن",
                replyMarkup: getKeyboard(['إضافة شهيد جديد'])
            }, env);
            return;
        }

        validRequests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        let requestsText = "<b>طلباتك المقدمة:</b>\n\n";

        for (const req of validRequests) {
            const martyrName = req.martyrData.full_name || 'غير محدد';
            const status = req.status;
            const createdAt = new Date(req.createdAt).toISOString().substring(0, 10);

            const statusEmoji = {
                'pending': '⳹',
                'approved': '✅',
                'rejected': '❌'
            }[status] || '❓';

            const statusText = {
                'pending': 'قيد المراجعة',
                'approved': 'تم القبول',
                'rejected': 'تم الرفض'
            }[status] || 'غير معروف';

            requestsText += `${statusEmoji} <b>${martyrName}</b>\n`;
            requestsText += `   الحالة: ${statusText}\n`;
            requestsText += `   التاريخ: ${createdAt}\n\n`;
        }

        await sendTelegramMessage(chatId, {
            text: requestsText,
            replyMarkup: getKeyboard(['إضافة شهيد جديد', 'مساعدة'])
        }, env);

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

async function startUploadProcess(chatId, userId, userInfo, env) {
    console.log(`Starting upload process for user ${userId}.`);
    const sessionData = {
        state: STATES.WAITING_FIRST_NAME,
        data: {},
        userInfo: userInfo,
        createdAt: new Date().toISOString()
    };

    const isSessionSaved = await saveUserSession(userId, sessionData, env);
    if (isSessionSaved) {
        await sendTelegramMessage(chatId, {
            text: "لنبدأ بإضافة شهيد جديد\n\nالرجاء إدخال الاسم الأول:",
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
يمكنك مشاهدة حالة جميع طلباتك المقدمة

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

    switch (currentState) {
        case STATES.WAITING_FIRST_NAME:
            if (!text.trim()) {
                await sendTelegramMessage(chatId, { text: "الرجاء إدخال الاسم الأول" }, env);
                return;
            }
            sessionData.first_name = text.trim();
            session.state = STATES.WAITING_FATHER_NAME;
            await sendTelegramMessage(chatId, {
                text: "الرجاء إدخال اسم الأب:",
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_FATHER_NAME:
            if (!text.trim()) {
                await sendTelegramMessage(chatId, { text: "الرجاء إدخال اسم الأب" }, env);
                return;
            }
            sessionData.father_name = text.trim();
            session.state = STATES.WAITING_FAMILY_NAME;
            await sendTelegramMessage(chatId, {
                text: "الرجاء إدخال اسم العائلة:",
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_FAMILY_NAME:
            if (!text.trim()) {
                await sendTelegramMessage(chatId, { text: "الرجاء إدخال اسم العائلة" }, env);
                return;
            }
            sessionData.family_name = text.trim();
            session.state = STATES.WAITING_AGE;
            await sendTelegramMessage(chatId, {
                text: "الرجاء إدخال عمر الشهيد:",
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
                text: "الرجاء إدخال تاريخ الولادة (مثال: 1990/01/15):",
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_BIRTH_DATE:
            if (!text.trim()) {
                await sendTelegramMessage(chatId, { text: "الرجاء إدخال تاريخ الولادة" }, env);
                return;
            }
            sessionData.birth_date = text.trim();
            session.state = STATES.WAITING_MARTYRDOM_DATE;
            await sendTelegramMessage(chatId, {
                text: "الرجاء إدخال تاريخ الاستشهاد (مثال: 2024/03/15):",
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_MARTYRDOM_DATE:
            if (!text.trim()) {
                await sendTelegramMessage(chatId, { text: "الرجاء إدخال تاريخ الاستشهاد" }, env);
                return;
            }
            sessionData.martyrdom_date = text.trim();
            session.state = STATES.WAITING_PLACE;
            await sendTelegramMessage(chatId, {
                text: "الرجاء إدخال مكان الاستشهاد:",
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
            break;

        case STATES.WAITING_PLACE:
            if (!text.trim()) {
                await sendTelegramMessage(chatId, { text: "الرجاء إدخال مكان الاستشهاد" }, env);
                return;
            }
            sessionData.place = text.trim();
            session.state = STATES.WAITING_PHOTO;
            await sendTelegramMessage(chatId, {
                text: "الرجاء إرسال صورة الشهيد:\n\nيمكنك إضافة تعليق على الصورة إذا رغبت",
                replyMarkup: getKeyboard(['إلغاء'])
            }, env);
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

async function completeRequest(chatId, userId, session, env) {
    console.log(`Completing request for user ${userId}.`);
    const martyrData = session.data;
    const fullName = `${martyrData.first_name || ''} ${martyrData.father_name || ''} ${martyrData.family_name || ''}`;

    let imgbbUrl = null;
    if (martyrData.photo_file_id) {
        await sendTelegramMessage(chatId, {
            text: "جاري تحميل الصورة، يرجى الانتظار...",
        }, env);
        imgbbUrl = await uploadPhotoToImgbb(martyrData.photo_file_id, env);
    }
    
    if (!imgbbUrl) {
         await sendTelegramMessage(chatId, {
            text: "حدث خطأ في تحميل الصورة. يرجى المحاولة مرة أخرى.",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        }, env);
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

    const requestId = await saveRequest(userId, requestData, env);

    if (requestId) {
        await clearUserSession(userId, env);

        const messageSummary = `تم إرسال طلبك بنجاح!

<b>ملخص البيانات:</b>
الاسم: ${fullName}
العمر: ${martyrData.age || 'غير متوفر'}
الولادة: ${martyrData.birth_date || 'غير متوفر'}
الاستشهاد: ${martyrData.martyrdom_date || 'غير متوفر'}
المكان: ${martyrData.place || 'غير متوفر'}

سيتم مراجعة طلبك من قبل الإدارة
يمكنك متابعة حالة طلبك باستخدام <b>عرض طلباتي</b>`;

        const photoFileId = martyrData.photo_file_id;
        if (photoFileId) {
            await sendTelegramMessage(chatId, {
                photoCaption: messageSummary,
                photoId: photoFileId,
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

async function completeRequest(chatId, userId, session, env) {
    console.log(`Completing request for user ${userId}.`);
    const martyrData = session.data;
    const fullName = `${martyrData.first_name || ''} ${martyrData.father_name || ''} ${martyrData.family_name || ''}`;

    let imgbbUrl = null;
    if (martyrData.photo_file_id) {
        await sendTelegramMessage(chatId, {
            text: "جاري تحميل الصورة، يرجى الانتظار...",
        }, env);
        imgbbUrl = await uploadPhotoToImgbb(martyrData.photo_file_id, env);
    }
    
    if (!imgbbUrl) {
         await sendTelegramMessage(chatId, {
            text: "حدث خطأ في تحميل الصورة. يرجى المحاولة مرة أخرى.",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        }, env);
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

    const requestId = await saveRequest(userId, requestData, env);

    if (requestId) {
        await clearUserSession(userId, env);

        const messageSummary = `تم إرسال طلبك بنجاح!

<b>ملخص البيانات:</b>
الاسم: ${fullName}
العمر: ${martyrData.age || 'غير متوفر'}
الولادة: ${martyrData.birth_date || 'غير متوفر'}
الاستشهاد: ${martyrData.martyrdom_date || 'غير متوفر'}
المكان: ${martyrData.place || 'غير متوفر'}

سيتم مراجعة طلبك من قبل الإدارة
يمكنك متابعة حالة طلبك باستخدام <b>عرض طلباتي</b>`;

        const photoFileId = martyrData.photo_file_id;
        if (photoFileId) {
            await sendTelegramMessage(chatId, {
                photoCaption: messageSummary,
                photoId: photoFileId,
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