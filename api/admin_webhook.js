// admin_webhook.js - Vercel Serverless Function for Admin Bot
const mongoose = require('mongoose');
const axios = require('axios');

// Configuration
const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN; // Use a new token for this bot
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '5679396406'; // Your Telegram User ID
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://adamabood92_db_user:Youns123@younss.ju4twkx.mongodb.net/?retryWrites=true&w=majority&appName=Younss';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/`;

// Global connection variable for reuse
let cachedConnection = null;

// MongoDB Connection with caching
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

// Schemas (assuming they are already defined in the main bot)
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

const Request = mongoose.models.Request || mongoose.model('Request', requestSchema);
const Martyr = mongoose.models.Martyr || mongoose.model('Martyr', martyrSchema);

// Utility Functions (simplified for admin bot)
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

async function sendTelegramMessage(chatId, options = {}) {
    console.log(`Sending message to chat ID: ${chatId}`);
    const { text, replyMarkup } = options;
    try {
        const response = await axios.post(`${TELEGRAM_API_URL}sendMessage`, {
            chat_id: chatId,
            text: text || "رسالة فارغة",
            parse_mode: 'HTML',
            reply_markup: replyMarkup ? JSON.stringify(replyMarkup) : undefined
        }, { timeout: 10000 });
        console.log(`Message sent successfully to chat ${chatId}`);
        return response.data;
    } catch (error) {
        console.error(`Error sending message to chat ${chatId}:`, error.response?.data || error.message);
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
                console.log(`Martyr data saved for request ID: ${requestId}`);

                request.status = 'approved';
                request.reviewedAt = new Date();
                await request.save({ session });
                console.log(`Request ID: ${requestId} status updated to approved.`);

                const martyrName = request.martyrData.full_name || 'غير محدد';
                await sendTelegramMessage(userId.toString(), {
                    text: `<b>تهانينا!</b>\n\nتم قبول طلبك لإضافة الشهيد <b>${martyrName}</b>.\n\nشكراً لك على مساهمتك في حفظ ذكرى شهدائنا الأبرار.`
                });
            } else if (newStatus === 'rejected') {
                await Request.deleteOne({ requestId }).session(session);
                console.log(`Rejected Request ID: ${requestId} has been deleted.`);

                const martyrName = request.martyrData.full_name || 'غير محدد';
                await sendTelegramMessage(userId.toString(), {
                    text: `<b>عذراً،</b>\n\nتم رفض طلبك لإضافة الشهيد <b>${martyrName}</b>.\n\nيمكنك تقديم طلب جديد بعد مراجعة البيانات والتأكد من صحتها.`
                });
            }
        });

        return true;
    } catch (error) {
        console.error('Error updating request status:', error);
        return false;
    } finally {
        await session.endSession();
    }
}

// Admin Handlers
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

            const summary = `<b>طلب جديد للمراجعة</b>\n\n<b>ID:</b> <code>${request.requestId}</code>\n<b>الاسم:</b> ${martyrData.full_name || 'غير محدد'}\n<b>العمر:</b> ${martyrData.age || 'غير متوفر'}\n<b>تاريخ الاستشهاد:</b> ${martyrData.date_martyrdom || 'غير متوفر'}\n<b>مكان الاستشهاد:</b> ${martyrData.place || 'غير متوفر'}\n\n<b>مقدم الطلب:</b> ${userInfo.first_name || ''} ${userInfo.last_name || ''} (@${userInfo.username || ''})\n<b>ID المستخدم:</b> <code>${userId}</code>`;
            
            const inlineKeyboard = getInlineKeyboard([
                { text: 'قبول', callback_data: `approve_${request.requestId}_${userId}` },
                { text: 'رفض', callback_data: `reject_${request.requestId}_${userId}` }
            ]);

            await sendTelegramMessage(chatId, {
                text: summary,
                replyMarkup: inlineKeyboard
            });
        }
    } catch (error) {
        console.error('Error reviewing pending requests:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ أثناء محاولة مراجعة الطلبات."
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

        const statsText = `<b>إحصائيات النظام</b>\n\n<b>الطلبات:</b>\nإجمالي الطلبات: ${totalRequests}\nقيد المراجعة: ${pendingRequests}\nتم القبول: ${approvedRequests}\nتم الرفض: ${rejectedRequests}\n\n<b>الشهداء:</b>\nإجمالي الشهداء المسجلين: ${totalMartyrs}`;

        await sendTelegramMessage(chatId, {
            text: statsText
        });
    } catch (error) {
        console.error('Error showing system stats:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في عرض الإحصائيات"
        });
    }
}

async function handleCallbackQuery(chatId, callbackData) {
    try {
        const parts = callbackData.split('_');
        const action = parts[0];
        const requestId = parts[1];
        const userIdOfRequest = parts[2];

        if (action === 'approve') {
            await updateRequestStatus(requestId, 'approved', userIdOfRequest);
        } else if (action === 'reject') {
            await updateRequestStatus(requestId, 'rejected', userIdOfRequest);
        } else {
            await sendTelegramMessage(chatId, {
                text: "عمل غير مدعوم"
            });
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await sendTelegramMessage(chatId, {
            text: "حدث خطأ في معالجة طلبك."
        });
    }
}

// Main handler
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            const update = req.body;
            await connectToDatabase();

            const isCallbackQuery = update.callback_query;
            const chatId = isCallbackQuery ? update.callback_query.message.chat.id : update.message.chat.id;
            const userId = isCallbackQuery ? update.callback_query.from.id.toString() : update.message.from.id.toString();

            if (userId !== ADMIN_USER_ID) {
                await sendTelegramMessage(chatId, { text: "عذراً، هذا البوت مخصص للمسؤولين فقط." });
                return res.status(200).json({ status: 'unauthorized' });
            }

            if (isCallbackQuery) {
                await handleCallbackQuery(chatId, update.callback_query.data);
            } else if (update.message.text) {
                const text = update.message.text;
                if (text === '/start') {
                    const welcomeText = `مرحباً بك في لوحة الإدارة
بوت معرض شهداء الساحل السوري
الأوامر المتاحة:
• مراجعة الطلبات المعلقة
• عرض إحصائيات النظام`;
                    await sendTelegramMessage(chatId, {
                        text: welcomeText,
                        replyMarkup: getKeyboard(['مراجعة الطلبات المعلقة', 'عرض إحصائيات النظام'])
                    });
                } else if (text === 'مراجعة الطلبات المعلقة' || text === '/review') {
                    await reviewPendingRequests(chatId);
                } else if (text === 'عرض إحصائيات النظام' || text === '/stats') {
                    await showSystemStats(chatId);
                } else {
                    await sendTelegramMessage(chatId, { text: "أمر غير مدعوم." });
                }
            } else {
                await sendTelegramMessage(chatId, { text: "نوع الرسالة غير مدعوم." });
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
                "message": "Syrian Martyrs Admin Bot is running!",
                "mongodb_status": "connected"
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
