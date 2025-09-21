// api/webhook.js - Vercel Serverless Function
const mongoose = require('mongoose');
const axios = require('axios');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN || '8272634262:AAHXUYw_Q-0fwuyFAc5j6ntgtZHt3VyWCOM';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '5679396406';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://adamabood92_db_user:Youns123@younss.ju4twkx.mongodb.net/?retryWrites=true&w=majority&appName=Younss';
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || '7b98d38c418169cf635290b4a31f8e95';

const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/`;

// Global connection variable for reuse
let cachedConnection = null;

// MongoDB Connection with caching for Vercel
async function connectToDatabase() {
    if (cachedConnection) {
        console.log('✅ Using cached MongoDB connection.');
        return cachedConnection;
    }

    try {
        console.log('⏳ Connecting to MongoDB...');
        const connection = await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 5, // Limit pool size for serverless
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        cachedConnection = connection;
        console.log('✅ Connected to MongoDB successfully.');
        return connection;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    }
}

// Schemas
const userSessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    state: { type: String, default: 'idle' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    userInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, expires: 3600 }, // Auto-delete after 1 hour
    updatedAt: { type: Date, default: Date.now }
});

// Missing martyrSchema definition - this was causing the error
const martyrSchema = new mongoose.Schema({
    nameFirst: { type: String, required: true },
    nameFather: { type: String, required: true },
    nameFamily: { type: String, required: true },
    fullName: { type: String, required: true, index: true },
    age: { type: Number },
    dateBirth: { type: String },
    dateMartyrdom: { type: String, required: true },
    place: { type: String, required: true },
    imageUrl: { type: String },
    createdAt: { type: Date, default: Date.now, index: true },
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

// Add TTL index to automatically delete pending requests after 30 days
// 30 days = 30 * 24 * 60 * 60 = 2592000 seconds
// requestSchema.index(
//     { "createdAt": 1 }, 
//     { expireAfterSeconds: 2592000, partialFilterExpression: { status: 'pending' } }
// );
// Add regular index for better performance
requestSchema.index({ status: 1, createdAt: -1 });
userSessionSchema.index({ updatedAt: 1 });

// Models
const UserSession = mongoose.models.UserSession || mongoose.model('UserSession', userSessionSchema);
const Martyr = mongoose.models.Martyr || mongoose.model('Martyr', martyrSchema);
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
            timeout: 10000, // 10 second timeout
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Message sent successfully to chat ${chatId}`);
        return response.data;
    } catch (error) {
        console.error(`❌ Error sending message to chat ${chatId}:`, error.response?.data || error.message);
        return null;
    }
}

async function getTelegramPhotoUrl(fileId) {
    try {
        const response = await axios.get(`${TELEGRAM_API_URL}getFile?file_id=${fileId}`);
        const filePath = response.data.result.file_path;
        return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    } catch (error) {
        console.error('❌ Error getting Telegram file path:', error.response?.data || error.message);
        return null;
    }
}

async function uploadPhotoToImgbb(fileId) {
    try {
        const fileUrl = await getTelegramPhotoUrl(fileId);
        if (!fileUrl) {
            console.error('❌ Could not get Telegram file URL.');
            return null;
        }

        const response = await axios.post('https://api.imgbb.com/1/upload', null, {
            params: {
                key: IMGBB_API_KEY,
                image: fileUrl
            }
        });

        if (response.data.success) {
            console.log('✅ Photo uploaded to imgbb successfully.');
            return response.data.data.url;
        } else {
            console.error('❌ imgbb upload failed:', response.data.error.message);
            return null;
        }
    } catch (error) {
        console.error('❌ Error uploading photo to imgbb:', error.response?.data || error.message);
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

function getInlineKeyboard(buttons) {
    return {
        inline_keyboard: buttons.map(btn => [{
            text: btn.text,
            callback_data: btn.callback_data
        }])
    };
}

// Database Functions with better error handling
async function saveUserSession(userId, sessionData) {
    try {
        const result = await UserSession.findOneAndUpdate(
            { userId: userId.toString() },
            { ...sessionData, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        console.log(`✅ Session saved for user ${userId}.`);
        return !!result;
    } catch (error) {
        console.error(`❌ Error saving session for user ${userId}:`, error);
        return false;
    }
}

async function getUserSession(userId) {
    try {
        const session = await UserSession.findOne({ userId: userId.toString() });
        console.log(`✅ Session retrieved for user ${userId}. State: ${session ? session.state : 'None'}`);
        return session || { state: STATES.IDLE, data: {} };
    } catch (error) {
        console.error(`❌ Error getting session for user ${userId}:`, error);
        return { state: STATES.IDLE, data: {} };
    }
}

async function clearUserSession(userId) {
    try {
        await UserSession.deleteOne({ userId: userId.toString() });
        console.log(`✅ Session cleared for user ${userId}.`);
        return true;
    } catch (error) {
        console.error(`❌ Error clearing session for user ${userId}:`, error);
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
        console.log(`✅ Request saved: ${requestId}`);
        return requestId;
    } catch (error) {
        console.error(`❌ Error saving request for user ${userId}:`, error);
        return null;
    }
}

async function updateRequestStatus(requestId, newStatus, userId) {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            const request = await Request.findOne({ requestId }).session(session);
            if (!request) {
                throw new Error('Request not found');
            }

            if (newStatus === 'approved') {
                // Save to martyrs collection
                const martyrData = new Martyr({
                    nameFirst: request.martyrData.name_first,
                    nameFather: request.martyrData.name_father,
                    nameFamily: request.martyrData.name_family,
                    fullName: request.martyrData.full_name,
                    age: request.martyrData.age,
                    dateBirth: request.martyrData.date_birth,
                    dateMartyrdom: request.martyrData.date_martyrdom,
                    place: request.martyrData.place,
                    imageUrl: request.martyrData.imageUrl
                });

                await martyrData.save({ session });
                console.log(`✅ Martyr data saved for request ID: ${requestId}`);

                // Update request status
                request.status = 'approved';
                request.reviewedAt = new Date();
                await request.save({ session });
                console.log(`✅ Request ID: ${requestId} status updated to approved.`);

                // Send notification to user
                const martyrName = request.martyrData.full_name || 'غير محدد';
                setTimeout(async () => {
                    await sendTelegramMessage(userId.toString(), {
                        text: `<b>🎉 تهانينا!</b>\n\nتم قبول طلبك لإضافة الشهيد <b>${martyrName}</b>.\n\nشكراً لك على مساهمتك في حفظ ذكرى شهدائنا الأبرار.`
                    });
                }, 1000);

            } else if (newStatus === 'rejected') {
                // Now delete the rejected request
                await Request.deleteOne({ requestId }).session(session);
                console.log(`✅ Rejected Request ID: ${requestId} has been deleted.`);

                // Send notification to user
                const martyrName = request.martyrData.full_name || 'غير محدد';
                setTimeout(async () => {
                    await sendTelegramMessage(userId.toString(), {
                        text: `<b>😔 عذراً،</b>\n\nتم رفض طلبك لإضافة الشهيد <b>${martyrName}</b>.\n\nيمكنك تقديم طلب جديد بعد مراجعة البيانات والتأكد من صحتها.\n\nللاستفسار تواصل مع: @DevYouns`
                    });
                }, 1000);
            }
        });

        return true;
    } catch (error) {
        console.error(`❌ Error updating request status:`, error);
        return false;
    } finally {
        await session.endSession();
    }
}

// Message Handlers
async function handleTextMessage(chatId, userId, text, userInfo) {
    try {
        console.log(`Handling text message from user ${userId}: "${text}"`);
        console.log(`Admin User ID from env: ${ADMIN_USER_ID}`);
        console.log(`Current User ID: ${userId}`);

        // Process user commands (admin check is handled inside processUserCommand)
        await processUserCommand(chatId, userId, text, userInfo);
    } catch (error) {
        console.error('❌ Error in handleTextMessage:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى."
        });
    }
}

async function processUserCommand(chatId, userId, text, userInfo) {
    console.log(`Processing user command: ${text}`);
    
    // Check if user is admin
    const isAdmin = userId.toString() === ADMIN_USER_ID.toString();
    console.log(`User ${userId} - Is Admin: ${isAdmin}`);
    
    if (text === '/start') {
        await clearUserSession(userId);
        
        if (isAdmin) {
            // Admin welcome message
            const adminWelcomeText = `👑 مرحباً بك في لوحة الإدارة

🌹 بوت معرض شهداء الساحل السوري
رحمهم الله وأسكنهم فسيح جناته

🔧 أوامر الإدارة:
• مراجعة الطلبات المعلقة
• إضافة شهيد جديد (كإدارة)
• عرض إحصائيات النظام

📋 أوامر المستخدمين العادية متاحة أيضاً`;

            await sendTelegramMessage(chatId, {
                text: adminWelcomeText,
                replyMarkup: getKeyboard([
                    'مراجعة الطلبات المعلقة', 
                    'إضافة شهيد جديد', 
                    'عرض إحصائيات النظام',
                    'عرض طلباتي',
                    'مساعدة'
                ])
            });
        } else {
            // Regular user welcome message
            const welcomeText = `🌹 أهلاً وسهلاً بك في بوت معرض شهداء الساحل السوري

رحمهم الله وأسكنهم فسيح جناته

📋 الأوامر المتاحة:
• إضافة شهيد جديد
• عرض طلباتي
• المساعدة

لبدء إضافة شهيد جديد، اضغط على <b>إضافة شهيد جديد</b>`;

            await sendTelegramMessage(chatId, {
                text: welcomeText,
                replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي', 'مساعدة'])
            });
        }
        return;
    }

    // Handle admin-specific commands
    if (isAdmin) {
        if (text === 'مراجعة الطلبات المعلقة' || text === '/review') {
            await reviewPendingRequests(chatId);
            return;
        } else if (text === 'عرض إحصائيات النظام' || text === '/stats') {
            await showSystemStats(chatId);
            return;
        } else if (text.startsWith('/approve')) {
            const parts = text.split(' ');
            if (parts.length === 3) {
                await approveRequest(chatId, parts[1], parts[2]);
            } else {
                await sendTelegramMessage(chatId, {
                    text: "صيغة الأمر غير صحيحة. الصيغة الصحيحة: /approve [request_id] [user_id]"
                });
            }
            return;
        } else if (text.startsWith('/reject')) {
            const parts = text.split(' ');
            if (parts.length === 3) {
                await rejectRequest(chatId, parts[1], parts[2]);
            } else {
                await sendTelegramMessage(chatId, {
                    text: "صيغة الأمر غير صحيحة. الصيغة الصحيحة: /reject [request_id] [user_id]"
                });
            }
            return;
        }
    }

    // Common commands for both admin and users
    if (text === 'إضافة شهيد جديد' || text === '/upload') {
        await startUploadProcess(chatId, userId, userInfo);

    } else if (text === 'مساعدة' || text === '/help') {
        await showHelp(chatId, isAdmin);

    } else if (text === 'عرض طلباتي' || text === '/my_requests') {
        await showUserRequests(chatId, userId);

    } else if (text === 'إلغاء' || text === '/cancel') {
        await clearUserSession(userId);
        const keyboard = isAdmin ? 
            ['مراجعة الطلبات المعلقة', 'إضافة شهيد جديد', 'عرض إحصائيات النظام'] :
            ['إضافة شهيد جديد'];
        
        await sendTelegramMessage(chatId, {
            text: "❌ تم إلغاء العملية الحالية\n\nيمكنك البدء من جديد",
            replyMarkup: getKeyboard(keyboard)
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
            text: "📝 لنبدأ بإضافة شهيد جديد\n\n1️⃣ الرجاء إدخال الاسم الأول:",
            replyMarkup: getKeyboard(['إلغاء'])
        });
    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
    }
}

async function showHelp(chatId, isAdmin = false) {
    if (isAdmin) {
        const adminHelpText = `📖 مساعدة لوحة الإدارة - بوت معرض شهداء الساحل السوري

👑 <b>أوامر الإدارة الخاصة:</b>
🔍 <b>مراجعة الطلبات المعلقة</b> - عرض ومراجعة طلبات إضافة الشهداء
📊 <b>عرض إحصائيات النظام</b> - عرض إحصائيات شاملة
✅ <b>/approve [request_id] [user_id]</b> - قبول طلب محدد
❌ <b>/reject [request_id] [user_id]</b> - رفض طلب محدد

👥 <b>الأوامر العامة (متاحة للإدارة أيضاً):</b>
📝 <b>إضافة شهيد جديد</b> - إضافة شهيد جديد للمعرض
📋 <b>عرض طلباتي</b> - عرض حالة طلباتك المقدمة

📞 للدعم التقني: @DevYouns`;

        await sendTelegramMessage(chatId, {
            text: adminHelpText,
            replyMarkup: getKeyboard([
                'مراجعة الطلبات المعلقة', 
                'إضافة شهيد جديد', 
                'عرض إحصائيات النظام'
            ])
        });
    } else {
        const helpText = `📖 مساعدة بوت معرض شهداء الساحل السوري

🔹 <b>إضافة شهيد جديد:</b>
يمكنك إضافة شهيد جديد باتباع الخطوات المطلوبة

🔹 <b>عرض طلباتي:</b>
يمكنك مشاهدة حالة جميع طلباتك المقدمة

📞 للمساعدة الإضافية، تواصل مع المدير: @DevYouns`;

        await sendTelegramMessage(chatId, {
            text: helpText,
            replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
        });
    }
}

async function handleUserInput(chatId, userId, text) {
    const session = await getUserSession(userId);
    console.log(`User ${userId} input: "${text}" with session state: ${session.state}`);

    if (session.state === STATES.IDLE) {
        await sendTelegramMessage(chatId, {
            text: "لا توجد عملية جارية. استخدم <b>إضافة شهيد جديد</b> لبدء الإضافة",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
        return;
    }

    const currentState = session.state;

    if (currentState === STATES.WAITING_FIRST_NAME) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "❌ الرجاء إدخال الاسم الأول" });
            return;
        }
        session.data.first_name = text.trim();
        session.state = STATES.WAITING_FATHER_NAME;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "2️⃣ الرجاء إدخال اسم الأب:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_FATHER_NAME) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "❌ الرجاء إدخال اسم الأب" });
            return;
        }
        session.data.father_name = text.trim();
        session.state = STATES.WAITING_FAMILY_NAME;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "3️⃣ الرجاء إدخال اسم العائلة:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_FAMILY_NAME) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "❌ الرجاء إدخال اسم العائلة" });
            return;
        }
        session.data.family_name = text.trim();
        session.state = STATES.WAITING_AGE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "4️⃣ الرجاء إدخال عمر الشهيد:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_AGE) {
        const age = parseInt(text);
        if (isNaN(age) || age < 0 || age > 150) {
            await sendTelegramMessage(chatId, { text: "❌ الرجاء إدخال عمر صحيح (0-150)" });
            return;
        }

        session.data.age = age;
        session.state = STATES.WAITING_BIRTH_DATE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "5️⃣ الرجاء إدخال تاريخ الولادة (مثال: 1990/01/15):",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_BIRTH_DATE) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "❌ الرجاء إدخال تاريخ الولادة" });
            return;
        }
        session.data.birth_date = text.trim();
        session.state = STATES.WAITING_MARTYRDOM_DATE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "6️⃣ الرجاء إدخال تاريخ الاستشهاد (مثال: 2024/03/15):",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_MARTYRDOM_DATE) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "❌ الرجاء إدخال تاريخ الاستشهاد" });
            return;
        }
        session.data.martyrdom_date = text.trim();
        session.state = STATES.WAITING_PLACE;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "7️⃣ الرجاء إدخال مكان الاستشهاد:",
            replyMarkup: getKeyboard(['إلغاء'])
        });

    } else if (currentState === STATES.WAITING_PLACE) {
        if (!text.trim()) {
            await sendTelegramMessage(chatId, { text: "❌ الرجاء إدخال مكان الاستشهاد" });
            return;
        }
        session.data.place = text.trim();
        session.state = STATES.WAITING_PHOTO;
        await saveUserSession(userId, session);
        await sendTelegramMessage(chatId, {
            text: "8️⃣ الرجاء إرسال صورة الشهيد:\n\nيمكنك إضافة تعليق على الصورة إذا رغبت",
            replyMarkup: getKeyboard(['إلغاء'])
        });
    }
}

async function handlePhotoMessage(chatId, userId, photoData, caption = '') {
    console.log(`Handling photo message from user ${userId}.`);
    const session = await getUserSession(userId);

    if (session.state !== STATES.WAITING_PHOTO) {
        await sendTelegramMessage(chatId, {
            text: "📸 يرجى اتباع الخطوات بالترتيب\n\nاستخدم <b>إضافة شهيد جديد</b> لبدء الإضافة",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
        return;
    }

    const photo = photoData[photoData.length - 1]; // أخذ أعلى دقة
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
            imageUrl: imgbbUrl, // New: Use imgbb URL
        },
        userInfo: session.userInfo,
        status: 'pending'
    };

    const requestId = await saveRequest(userId, requestData);

    if (requestId) {
        await clearUserSession(userId);

        const messageSummary = `✅ تم إرسال طلبك بنجاح!

📋 ملخص البيانات:
👤 الاسم: ${fullName}
🎂 العمر: ${martyrData.age || 'غير متوفر'}
📅 الولادة: ${martyrData.birth_date || 'غير متوفر'}
🕊️ الاستشهاد: ${martyrData.martyrdom_date || 'غير متوفر'}
📍 المكان: ${martyrData.place || 'غير متوفر'}

⏳ سيتم مراجعة طلبك من قبل الإدارة
📱 يمكنك متابعة حالة طلبك باستخدام <b>عرض طلباتي</b>`;

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

        // Send notification to admin
        const adminNotificationText = `<b>⭐ طلب جديد للمراجعة ⭐</b>\n\n<b>ID الطلب:</b> <code>${requestId}</code>\n<b>ID المستخدم:</b> <code>${userId}</code>\n<b>الاسم:</b> ${fullName}\n\n<b>مقدم الطلب:</b> ${session.userInfo.first_name || ''} ${session.userInfo.last_name || ''} (@${session.userInfo.username || ''})\n\nيمكنك مراجعة الطلب باستخدام /review`;
        await sendTelegramMessage(ADMIN_USER_ID, { text: adminNotificationText });

    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
    }
}

async function showSystemStats(chatId) {
    try {
        const [totalRequests, pendingRequests, approvedRequests, rejectedRequests, totalMartyrs] = await Promise.all([
            Request.countDocuments(),
            Request.countDocuments({ status: 'pending' }),
            Request.countDocuments({ status: 'approved' }),
            Request.countDocuments({ status: 'rejected' }),
            Martyr.countDocuments()
        ]);

        const statsText = `📊 <b>إحصائيات النظام</b>

👥 <b>الطلبات:</b>
📋 إجمالي الطلبات: ${totalRequests}
⏳ قيد المراجعة: ${pendingRequests}
✅ تم القبول: ${approvedRequests}
❌ تم الرفض: ${rejectedRequests}

🌹 <b>الشهداء:</b>
👤 إجمالي الشهداء المسجلين: ${totalMartyrs}

📈 <b>معدل القبول:</b>
${totalRequests > 0 ? Math.round((approvedRequests / totalRequests) * 100) : 0}%`;

        await sendTelegramMessage(chatId, {
            text: statsText,
            replyMarkup: getKeyboard([
                'مراجعة الطلبات المعلقة', 
                'إضافة شهيد جديد',
                'مساعدة'
            ])
        });

    } catch (error) {
        console.error('❌ Error showing system stats:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض الإحصائيات",
            replyMarkup: getKeyboard(['مراجعة الطلبات المعلقة', 'إضافة شهيد جديد'])
        });
    }
}
    try {
        const requests = await Request.find({ userId: userId.toString() })
            .sort({ createdAt: -1 })
            .limit(10);
        console.log(`Found ${requests.length} requests for user ${userId}.`);

        if (!requests.length) {
            await sendTelegramMessage(chatId, {
                text: "🔭 لا توجد طلبات مقدمة من قبلك حتى الآن",
                replyMarkup: getKeyboard(['إضافة شهيد جديد'])
            });
            return;
        }

        let requestsText = "<b>📋 طلباتك المقدمة:</b>\n\n";

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
        console.error('❌ Error showing user requests:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض طلباتك",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
    }
}

async function reviewPendingRequests(chatId) {
    try {
        const requests = await Request.find({ status: 'pending' })
            .sort({ createdAt: -1 })
            .limit(5);

        console.log(`Found ${requests.length} pending requests to review.`);
        if (!requests.length) {
            await sendTelegramMessage(chatId, {
                text: "لا توجد طلبات معلقة للمراجعة في الوقت الحالي."
            });
            return;
        }

        for (const request of requests) {
            const martyrData = request.martyrData;
            const userInfo = request.userInfo;
            const userId = request.userId;

            const summary = `<b>طلب جديد للمراجعة</b>\n\n<b>ID:</b> <code>${request.requestId}</code>\n<b>الاسم:</b> ${martyrData.full_name || 'غير محدد'}\n<b>العمر:</b> ${martyrData.age || 'غير متوفر'}\n<b>تاريخ الولادة:</b> ${martyrData.date_birth || 'غير متوفر'}\n<b>تاريخ الاستشهاد:</b> ${martyrData.date_martyrdom || 'غير متوفر'}\n<b>مكان الاستشهاد:</b> ${martyrData.place || 'غير متوفر'}\n\n<b>مقدم الطلب:</b> ${userInfo.first_name || ''} ${userInfo.last_name || ''} (@${userInfo.username || ''})\n<b>ID المستخدم:</b> <code>${userId}</code>`;

            let photoFileId = null;
            if (martyrData.imageUrl && martyrData.imageUrl.includes('photos')) {
                photoFileId = martyrData.imageUrl.split('/').pop();
            }

            const inlineKeyboard = getInlineKeyboard([
                { text: '✅ قبول', callback_data: `approve_${request.requestId}_${userId}` },
                { text: '❌ رفض', callback_data: `reject_${request.requestId}_${userId}` }
            ]);

            if (photoFileId) {
                await sendTelegramMessage(chatId, {
                    photoId: photoFileId,
                    photoCaption: summary,
                    replyMarkup: inlineKeyboard
                });
            } else {
                await sendTelegramMessage(chatId, {
                    text: summary,
                    replyMarkup: inlineKeyboard
                });
            }
        }
    } catch (error) {
        console.error('❌ Error reviewing pending requests:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ أثناء محاولة مراجعة الطلبات."
        });
    }
}

async function approveRequest(chatId, requestId, userIdReq) {
    try {
        if (await updateRequestStatus(requestId, 'approved', userIdReq)) {
            await sendTelegramMessage(chatId, {
                text: `✅ تم قبول الطلب <code>${requestId}</code> بنجاح.`
            });
        } else {
            await sendTelegramMessage(chatId, {
                text: `❌ حدث خطأ في قبول الطلب <code>${requestId}</code>.`
            });
        }
    } catch (error) {
        console.error('❌ Error approving request:', error);
        await sendTelegramMessage(chatId, {
            text: `❌ حدث خطأ في قبول الطلب <code>${requestId}</code>.`
        });
    }
}

async function rejectRequest(chatId, requestId, userIdReq) {
    try {
        if (await updateRequestStatus(requestId, 'rejected', userIdReq)) {
            await sendTelegramMessage(chatId, {
                text: `❌ تم رفض الطلب <code>${requestId}</code> بنجاح.`
            });
        } else {
            await sendTelegramMessage(chatId, {
                text: `❌ حدث خطأ في رفض الطلب <code>${requestId}</code>.`
            });
        }
    } catch (error) {
        console.error('❌ Error rejecting request:', error);
        await sendTelegramMessage(chatId, {
            text: `❌ حدث خطأ في رفض الطلب <code>${requestId}</code>.`
        });
    }
}

async function handleCallbackQuery(chatId, callbackData) {
    try {
        console.log(`Handling callback query: ${callbackData}`);
        const parts = callbackData.split('_');
        if (parts.length < 3) {
            await sendTelegramMessage(chatId, {
                text: "❌ بيانات غير صحيحة"
            });
            return;
        }

        const action = parts[0];
        const requestId = parts[1];
        const userIdOfRequest = parts[2];

        if (action === 'approve') {
            await approveRequest(chatId, requestId, userIdOfRequest);
        } else if (action === 'reject') {
            await rejectRequest(chatId, requestId, userIdOfRequest);
        } else {
            await sendTelegramMessage(chatId, {
                text: "❌ عمل غير مدعوم"
            });
        }
    } catch (error) {
        console.error('❌ Error handling callback query:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في معالجة طلبك."
        });
    }
}

// Main handler
module.exports = async (req, res) => {
    // Check if the request method is POST
    if (req.method === 'POST') {
        try {
            const update = req.body;
            console.log('📨 Received update from Telegram');

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

                // Connect to database
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
            } else if (update.callback_query) {
                const callbackQuery = update.callback_query;
                const chatId = callbackQuery.message.chat.id;
                await handleCallbackQuery(chatId, callbackQuery.data);
            }

            // Always respond with 200 OK to Telegram
            return res.status(200).json({ status: 'ok' });

        } catch (error) {
            console.error('❌ Error processing webhook:', error);

            // Still return 200 to avoid Telegram retries
            return res.status(200).json({
                status: 'error',
                message: 'Internal error occurred',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Hidden'
            });
        }
    }

    // Handle other requests (e.g., GET)
    if (req.method === 'GET' || req.method === 'OPTIONS') {
        try {
            await connectToDatabase();
            return res.status(200).json({
                "status": "ok",
                "message": "Syrian Martyrs Bot is running! 🌹",
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

    // Method not allowed
    return res.status(405).json({
        status: 'error',
        message: 'Method not allowed'
    });
};