// api/webhook.js - Vercel Serverless Function for User Bot
const mongoose = require('mongoose');
const axios = require('axios');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN || '8272634262:AAHXUYw_Q-0fwuyFAc5j6ntgtZHt3VyWCOM';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://adamabood92_db_user:Youns123@younss.ju4twkx.mongodb.net/?retryWrites=true&w=majority&appName=Younss';
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || '7b98d38c418169cf635290b4a31f8e95';

const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/`;

// Global connection variable for reuse
let cachedConnection = null;

// MongoDB Connection with caching for Vercel
async function connectToDatabase() {
    if (cachedConnection) {
        console.log('Using cached MongoDB connection.');
        return cachedConnection;
    }

    try {
        console.log('Connecting to MongoDB...');
        const connection = await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        cachedConnection = connection;
        console.log('Connected to MongoDB successfully.');
        return connection;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

// Schemas
const userSessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    state: { type: String, default: 'idle' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    userInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, expires: 3600 },
    updatedAt: { type: Date, default: Date.now }
});

const requestSchema = new mongoose.Schema({
    requestId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    martyrData: { type: mongoose.Schema.Types.Mixed, required: true },
    userInfo: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    createdAt: { type: Date, default: Date.now, index: true },
    reviewedAt: { type: Date }
});

// Add indexes
requestSchema.index({ status: 1, createdAt: -1 });
userSessionSchema.index({ updatedAt: 1 });

// Models
const UserSession = mongoose.models.UserSession || mongoose.model('UserSession', userSessionSchema);
const Request = mongoose.models.Request || mongoose.model('Request', requestSchema);

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

// Utility Functions
function generateRequestId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

async function sendTelegramMessage(chatId, options = {}) {
    console.log(`Sending message to chat ID: ${chatId}`);
    const { text, replyMarkup, photoId, photoCaption } = options;

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
        const response = await axios.post(url, payload, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log(`Message sent successfully to chat ${chatId}`);
        return response.data;
    } catch (error) {
        console.error(`Error sending message to chat ${chatId}:`, error.response?.data || error.message);
        return null;
    }
}

async function getTelegramPhotoUrl(fileId) {
    try {
        const response = await axios.get(`${TELEGRAM_API_URL}getFile?file_id=${fileId}`);
        const filePath = response.data.result.file_path;
        return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    } catch (error) {
        console.error('Error getting Telegram file path:', error.response?.data || error.message);
        return null;
    }
}

async function uploadPhotoToImgbb(fileId) {
    try {
        const fileUrl = await getTelegramPhotoUrl(fileId);
        if (!fileUrl) {
            console.error('Could not get Telegram file URL.');
            return null;
        }

        const response = await axios.post('https://api.imgbb.com/1/upload', null, {
            params: {
                key: IMGBB_API_KEY,
                image: fileUrl
            }
        });

        if (response.data.success) {
            console.log('Photo uploaded to imgbb successfully.');
            return response.data.data.url;
        } else {
            console.error('imgbb upload failed:', response.data.error.message);
            return null;
        }
    } catch (error) {
        console.error('Error uploading photo to imgbb:', error.response?.data || error.message);
        return null;
    }
}

function getKeyboard(buttons) {
    return {
        keyboard: buttons.map(btn => [{ text: btn }]),
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

async function saveUserSession(userId, sessionData) {
    try {
        const result = await UserSession.findOneAndUpdate(
            { userId: userId.toString() },
            { ...sessionData, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        console.log(`Session saved for user ${userId}.`);
        return !!result;
    } catch (error) {
        console.error(`Error saving session for user ${userId}:`, error);
        return false;
    }
}

async function getUserSession(userId) {
    try {
        const session = await UserSession.findOne({ userId: userId.toString() });
        console.log(`Session retrieved for user ${userId}. State: ${session ? session.state : 'None'}`);
        return session || { state: STATES.IDLE, data: {} };
    } catch (error) {
        console.error(`Error getting session for user ${userId}:`, error);
        return { state: STATES.IDLE, data: {} };
    }
}

async function clearUserSession(userId) {
    try {
        await UserSession.deleteOne({ userId: userId.toString() });
        console.log(`Session cleared for user ${userId}.`);
        return true;
    } catch (error) {
        console.error(`Error clearing session for user ${userId}:`, error);
        return false;
    }
}

async function saveRequest(userId, requestData) {
    try {
        const requestId = generateRequestId();
        const request = new Request({
            requestId,
            userId: userId.toString(),
            ...requestData
        });

        await request.save();
        console.log(`Request saved: ${requestId}`);
        return requestId;
    } catch (error) {
        console.error(`Error saving request for user ${userId}:`, error);
        return null;
    }
}

async function showUserRequests(chatId, userId) {
    try {
        const requests = await Request.find({ userId: userId.toString() })
            .sort({ createdAt: -1 })
            .limit(10);
        console.log(`Found ${requests.length} requests for user ${userId}.`);

        if (!requests.length) {
            await sendTelegramMessage(chatId, {
                text: "لا توجد طلبات مقدمة من قبلك حتى الآن",
                replyMarkup: getKeyboard(['إضافة شهيد جديد'])
            });
            return;
        }

        let requestsText = "<b>طلباتك المقدمة:</b>\n\n";

        for (const req of requests) {
            const martyrName = req.martyrData.full_name || 'غير محدد';
            const status = req.status;
            const createdAt = req.createdAt.toISOString().substring(0, 10);

            const statusEmoji = {
                'pending': '⏳',
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
        });

    } catch (error) {
        console.error('Error showing user requests:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض طلباتك",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
    }
}

async function handleTextMessage(chatId, userId, text, userInfo) {
    try {
        console.log(`Handling text message from user ${userId}: "${text}"`);
        await processUserCommand(chatId, userId, text, userInfo);
    } catch (error) {
        console.error('Error in handleTextMessage:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى."
        });
    }
}

async function processUserCommand(chatId, userId, text, userInfo) {
    console.log(`Processing user command: ${text}`);
    
    if (text === '/start') {
        await clearUserSession(userId);
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
        });
        return;
    }

    if (text === 'إضافة شهيد جديد' || text === '/upload') {
        await startUploadProcess(chatId, userId, userInfo);
    } else if (text === 'مساعدة' || text === '/help') {
        await showHelp(chatId);
    } else if (text === 'عرض طلباتي' || text === '/my_requests') {
        await showUserRequests(chatId, userId);
    } else if (text === 'إلغاء' || text === '/cancel') {
        await clearUserSession(userId);
        await sendTelegramMessage(chatId, {
            text: "تم إلغاء العملية الحالية\n\nيمكنك البدء من جديد",
            replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي', 'مساعدة'])
        });
    } else {
        await handleUserInput(chatId, userId, text);
    }
}

async function startUploadProcess(chatId, userId, userInfo) {
    console.log(`Starting upload process for user ${userId}.`);
    const sessionData = {
        state: STATES.WAITING_FIRST_NAME,
        data: {},
        userInfo: userInfo,
        createdAt: new Date()
    };

    if (await saveUserSession(userId, sessionData)) {
        await sendTelegramMessage(chatId, {
            text: "لنبدأ بإضافة شهيد جديد\n\nالرجاء إدخال الاسم الأول:",
            replyMarkup: getKeyboard(['إلغاء'])
        });
    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
    }
}

async function showHelp(chatId) {
    const helpText = `مساعدة بوت معرض شهداء الساحل السوري

<b>إضافة شهيد جديد:</b>
يمكنك إضافة شهيد جديد باتباع الخطوات المطلوبة

<b>عرض طلباتي:</b>
يمكنك مشاهدة حالة جميع طلباتك المقدمة

للمساعدة الإضافية، تواصل مع المدير: @DevYouns`;

    await sendTelegramMessage(chatId, {
        text: helpText,
        replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
    });
}

async function handleUserInput(chatId, userId, text) {
    const session = await getUserSession(userId);
    console.log(`User ${userId} input: "${text}" with session state: ${session.state}`);

    if (session.state === STATES.IDLE) {
        await sendTelegramMessage(chatId, {
            text: "لا توجد عملية جارية. استخدم <b>إضافة شهيد جديد</b> لبدء الإضافة",
            replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
        });
        return;
    }

    const currentState = session.state;

    if (currentState === STATES.WAITING_FIRST_NAME) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "الرجاء إدخال الاسم الأول" });
            return;
        }
        session.data.first_name = text.trim();
        session.state = STATES.WAITING_FATHER_NAME;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "الرجاء إدخال اسم الأب:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_FATHER_NAME) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "الرجاء إدخال اسم الأب" });
            return;
        }
        session.data.father_name = text.trim();
        session.state = STATES.WAITING_FAMILY_NAME;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "الرجاء إدخال اسم العائلة:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_FAMILY_NAME) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "الرجاء إدخال اسم العائلة" });
            return;
        }
        session.data.family_name = text.trim();
        session.state = STATES.WAITING_AGE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "الرجاء إدخال عمر الشهيد:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_AGE) {
        const age = parseInt(text);
        if (isNaN(age) || age < 0 || age > 150) {
            await sendTelegramMessage(chatId, { text: "الرجاء إدخال عمر صحيح (0-150)" });
            return;
        }

        session.data.age = age;
        session.state = STATES.WAITING_BIRTH_DATE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "الرجاء إدخال تاريخ الولادة (مثال: 1990/01/15):",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_BIRTH_DATE) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "الرجاء إدخال تاريخ الولادة" });
            return;
        }
        session.data.birth_date = text.trim();
        session.state = STATES.WAITING_MARTYRDOM_DATE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "الرجاء إدخال تاريخ الاستشهاد (مثال: 2024/03/15):",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_MARTYRDOM_DATE) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "الرجاء إدخال تاريخ الاستشهاد" });
            return;
        }
        session.data.martyrdom_date = text.trim();
        session.state = STATES.WAITING_PLACE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "الرجاء إدخال مكان الاستشهاد:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_PLACE) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "الرجاء إدخال مكان الاستشهاد" });
            return;
        }
        session.data.place = text.trim();
        session.state = STATES.WAITING_PHOTO;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "الرجاء إرسال صورة الشهيد:\n\nيمكنك إضافة تعليق على الصورة إذا رغبت",
            replyMarkup: getKeyboard(['إلغاء'])
        });
    }
}

async function handlePhotoMessage(chatId, userId, photoData, caption = '') {
    console.log(`Handling photo message from user ${userId}.`);
    const session = await getUserSession(userId);

    if (session.state !== STATES.WAITING_PHOTO) {
        await sendTelegramMessage(chatId, {
            text: "يرجى اتباع الخطوات بالترتيب\n\nاستخدم <b>إضافة شهيد جديد</b> لبدء الإضافة",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
        return;
    }

    const photo = photoData[photoData.length - 1];
    const photoFileId = photo.file_id;
    session.data.photo_file_id = photoFileId;
    session.data.photo_caption = caption;

    await completeRequest(chatId, userId, session);
}

async function completeRequest(chatId, userId, session) {
    console.log(`Completing request for user ${userId}.`);
    const martyrData = session.data;
    const fullName = `${martyrData.first_name || ''} ${martyrData.father_name || ''} ${martyrData.family_name || ''}`;

    let imgbbUrl = null;
    if (martyrData.photo_file_id) {
        imgbbUrl = await uploadPhotoToImgbb(martyrData.photo_file_id);
    }
    
    if (!imgbbUrl) {
         await sendTelegramMessage(chatId, {
            text: "حدث خطأ في تحميل الصورة. يرجى المحاولة مرة أخرى.",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
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
        userInfo: session.userInfo,
        status: 'pending'
    };

    const requestId = await saveRequest(userId, requestData);

    if (requestId) {
        await clearUserSession(userId);

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
            });
        } else {
            await sendTelegramMessage(chatId, {
                text: messageSummary,
                replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
            });
        }

    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
    }
}

// Main handler
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            const update = req.body;
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

                await connectToDatabase();

                if (message.text) {
                    await handleTextMessage(chatId, userId, message.text, userInfo);
                } else if (message.photo) {
                    const caption = message.caption || '';
                    await handlePhotoMessage(chatId, userId, message.photo, caption);
                } else {
                    await sendTelegramMessage(chatId, {
                        text: "نوع الرسالة غير مدعوم. يرجى إرسال نص أو صورة فقط."
                    });
                }
            } else { // No callback queries for user bot
                console.log('Received unsupported update type.');
            }

            return res.status(200).json({ status: 'ok' });

        } catch (error) {
            console.error('Error processing webhook:', error);
            return res.status(200).json({
                status: 'error',
                message: 'Internal error occurred',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Hidden'
            });
        }
    }

    if (req.method === 'GET' || req.method === 'OPTIONS') {
        try {
            await connectToDatabase();
            return res.status(200).json({
                "status": "ok",
                "message": "Syrian Martyrs Bot is running!",
                "mongodb_status": "connected",
                "platform": "Vercel Serverless"
            });
        } catch (error) {
            return res.status(500).json({
                "status": "error",
                "message": "Bot is not connected to MongoDB.",
                "error": error.message
            });
        }
    }

    return res.status(405).json({
        status: 'error',
        message: 'Method not allowed'
    });
};
