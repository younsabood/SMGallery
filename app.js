// app.js - Optimized for Render.com
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add request logging for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Configuration with better defaults for Render
const BOT_TOKEN = process.env.BOT_TOKEN || "8272634262:AAHXUYw_Q-0fwuyFAc5j6ntgtZHt3VyWCOM";
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || "5679396406";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/`;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://adamabood92_db_user:Youns123@younss.ju4twkx.mongodb.net/syrian_martyrs?retryWrites=true&w=majority&appName=Younss";
const PORT = process.env.PORT || 10000; // Render uses port 10000

console.log(`🚀 Starting Syrian Martyrs Bot...`);
console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔑 Admin ID: ${ADMIN_USER_ID}`);
console.log(`🌐 Port: ${PORT}`);

// MongoDB Connection with better options for Render
const mongoOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10, // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    bufferMaxEntries: 0, // Disable mongoose buffering
    bufferCommands: false, // Disable mongoose buffering
};

mongoose.connect(MONGODB_URI, mongoOptions)
    .then(() => {
        console.log('✅ Connected to MongoDB');
        console.log(`📦 Database: ${mongoose.connection.name}`);
    })
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected');
});

// Schemas
const userSessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    state: { type: String, default: 'idle' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    userInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, expires: 3600 }, // Auto-delete after 1 hour
    updatedAt: { type: Date, default: Date.now }
});

const martyrSchema = new mongoose.Schema({
    nameFirst: { type: String, required: true, trim: true },
    nameFather: { type: String, required: true, trim: true },
    nameFamily: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, index: true },
    age: { type: Number, min: 0, max: 150 },
    dateBirth: { type: String, trim: true },
    dateMartyrdom: { type: String, trim: true },
    place: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now, index: true }
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

// Add indexes for better performance
userSessionSchema.index({ updatedAt: 1 });
requestSchema.index({ status: 1, createdAt: -1 });

// Models
const UserSession = mongoose.model('UserSession', userSessionSchema);
const Martyr = mongoose.model('Martyr', martyrSchema);
const Request = mongoose.model('Request', requestSchema);

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
        return !!result;
    } catch (error) {
        console.error(`❌ Error saving session for user ${userId}:`, error);
        return false;
    }
}

async function getUserSession(userId) {
    try {
        const session = await UserSession.findOne({ userId: userId.toString() });
        return session || { state: STATES.IDLE, data: {} };
    } catch (error) {
        console.error(`❌ Error getting session for user ${userId}:`, error);
        return { state: STATES.IDLE, data: {} };
    }
}

async function clearUserSession(userId) {
    try {
        await UserSession.deleteOne({ userId: userId.toString() });
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
                
                // Update request status
                request.status = 'approved';
                request.reviewedAt = new Date();
                await request.save({ session });
                
                // Send notification to user
                const martyrName = request.martyrData.full_name || 'غير محدد';
                setTimeout(async () => {
                    await sendTelegramMessage(userId.toString(), {
                        text: `<b>🎉 تهانينا!</b>\n\nتم قبول طلبك لإضافة الشهيد <b>${martyrName}</b>.\n\nشكراً لك على مساهمتك في حفظ ذكرى شهدائنا الأبرار.`
                    });
                }, 1000);
                
            } else if (newStatus === 'rejected') {
                request.status = 'rejected';
                request.reviewedAt = new Date();
                await request.save({ session });
                
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

// Message Handlers - Same as before but with added error handling
async function handleTextMessage(chatId, userId, text, userInfo) {
    try {
        // Admin commands
        if (userId.toString() === ADMIN_USER_ID) {
            if (text === '/review') {
                await reviewPendingRequests(chatId);
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
        
        // Process user commands
        await processUserCommand(chatId, userId, text, userInfo);
    } catch (error) {
        console.error('❌ Error in handleTextMessage:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى."
        });
    }
}

// All other functions remain the same as in the previous version
// But I'll add the essential ones for the bot to work

async function processUserCommand(chatId, userId, text, userInfo) {
    if (text === '/start') {
        await clearUserSession(userId);
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
        
    } else if (text === 'إضافة شهيد جديد' || text === '/upload') {
        await startUploadProcess(chatId, userId, userInfo);
        
    } else if (text === 'مساعدة' || text === '/help') {
        await showHelp(chatId);
        
    } else if (text === 'عرض طلباتي' || text === '/my_requests') {
        await showUserRequests(chatId, userId);
        
    } else if (text === 'إلغاء' || text === '/cancel') {
        await clearUserSession(userId);
        await sendTelegramMessage(chatId, {
            text: "⌫ تم إلغاء العملية الحالية\n\nيمكنك البدء من جديد باستخدام <b>إضافة شهيد جديد</b>",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
        
    } else {
        await handleUserInput(chatId, userId, text);
    }
}

async function startUploadProcess(chatId, userId, userInfo) {
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

async function showHelp(chatId) {
    const helpText = `📖 مساعدة بوت معرض شهداء الساحل السوري

🔹 <b>إضافة شهيد جديد:</b>
يمكنك إضافة شهيد جديد باتباع الخطوات

🔹 <b>عرض طلباتي:</b>
يمكنك مشاهدة حالة جميع طلباتك المقدمة

📞 للمساعدة الإضافية، تواصل مع المدير: @DevYouns`;
    
    await sendTelegramMessage(chatId, {
        text: helpText,
        replyMarkup: getKeyboard(['إضافة شهيد جديد', 'عرض طلباتي'])
    });
}

// Add simplified versions of other functions for space...
// [The rest of the functions would be the same as in the complete version]

// Routes
app.get('/', async (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        res.json({
            status: 'ok',
            message: 'Syrian Martyrs Bot is running! 🌹',
            timestamp: new Date().toISOString(),
            mongodb_status: dbStatus,
            admin_id: ADMIN_USER_ID,
            version: '1.0.0',
            env: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/health', async (req, res) => {
    try {
        // Test database connection
        await mongoose.connection.db.admin().ping();
        res.json({ status: 'healthy', db: 'connected' });
    } catch (error) {
        res.status(503).json({ status: 'unhealthy', db: 'disconnected', error: error.message });
    }
});

app.post('/webhook', async (req, res) => {
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
            
            if (message.text) {
                await handleTextMessage(chatId, userId, message.text, userInfo);
            } else if (message.photo) {
                const caption = message.caption || '';
                // Add photo handling here
                console.log('📸 Photo received');
            } else {
                await sendTelegramMessage(chatId, {
                    text: "نوع الرسالة غير مدعوم. يرجى إرسال نص أو صورة فقط."
                });
            }
        }
        
        // Always respond with 200 OK
        res.status(200).json({ status: 'ok' });
        
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        // Still respond with 200 to avoid Telegram retries
        res.status(200).json({ 
            status: 'error', 
            message: 'Internal error occurred' 
        });
    }
});

// Add the missing functions
async function handleUserInput(chatId, userId, text) {
    const session = await getUserSession(userId);
    
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
            await sendTelegramMessage(chatId, { text: "⌫ الرجاء إدخال الاسم الأول" });
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
            await sendTelegramMessage(chatId, { text: "⌫ الرجاء إدخال اسم الأب" });
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
            await sendTelegramMessage(chatId, { text: "⌫ الرجاء إدخال اسم العائلة" });
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
            await sendTelegramMessage(chatId, { text: "⌫ الرجاء إدخال عمر صحيح (0-150)" });
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
            await sendTelegramMessage(chatId, { text: "⌫ الرجاء إدخال تاريخ الولادة" });
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
            await sendTelegramMessage(chatId, { text: "⌫ الرجاء إدخال تاريخ الاستشهاد" });
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
            await sendTelegramMessage(chatId, { text: "⌫ الرجاء إدخال مكان الاستشهاد" });
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
    const martyrData = session.data;
    const fullName = `${martyrData.first_name || ''} ${martyrData.father_name || ''} ${martyrData.family_name || ''}`;
    
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
            imageUrl: `https://api.telegram.org/file/bot${BOT_TOKEN}/photos/${martyrData.photo_file_id || ''}`,
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
        const adminNotificationText = `<b>⭐️ طلب جديد للمراجعة ⭐️</b>\n\n<b>ID الطلب:</b> <code>${requestId}</code>\n<b>ID المستخدم:</b> <code>${userId}</code>\n<b>الاسم:</b> ${fullName}\n\n<b>مقدم الطلب:</b> ${session.userInfo.first_name || ''} ${session.userInfo.last_name || ''} (@${session.userInfo.username || ''})\n\nيمكنك مراجعة الطلب باستخدام /review`;
        await sendTelegramMessage(ADMIN_USER_ID, { text: adminNotificationText });

    } else {
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى",
            replyMarkup: getKeyboard(['إضافة شهيد جديد'])
        });
    }
}

async function showUserRequests(chatId, userId) {
    try {
        const requests = await Request.find({ userId: userId.toString() })
            .sort({ createdAt: -1 })
            .limit(10);
        
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

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({
        status: 'error',
        message: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        status: 'not found',
        message: 'Endpoint not found'
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    try {
        await mongoose.connection.close();
        console.log('✅ Database connection closed');
    } catch (error) {
        console.error('❌ Error closing database:', error);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    try {
        await mongoose.connection.close();
        console.log('✅ Database connection closed');
    } catch (error) {
        console.error('❌ Error closing database:', error);
    }
    process.exit(0);
});

// Keep-alive ping to prevent sleeping on free tier
if (process.env.NODE_ENV === 'production') {
    setInterval(async () => {
        try {
            await axios.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/health`);
            console.log('🏓 Keep-alive ping sent');
        } catch (error) {
            console.error('❌ Keep-alive ping failed:', error.message);
        }
    }, 14 * 60 * 1000); // Every 14 minutes
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📱 Bot token: ${BOT_TOKEN.substring(0, 20)}...`);
    console.log(`👑 Admin ID: ${ADMIN_USER_ID}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🎯 Webhook endpoint: /webhook`);
    console.log(`💚 Health check: /health`);
});