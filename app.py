import os
import json
import logging
from datetime import datetime
from flask import Flask, request, jsonify
import requests
import firebase_admin
from firebase_admin import credentials, db

# إعداد التسجيل
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# إعداد Flask
app = Flask(__name__)

# إعدادات البوت
BOT_TOKEN = "8272634262:AAHXUYw_Q-0fwuyFAc5j6ntgtZHt3VyWCOM"
ADMIN_USER_ID = "5679396406"  # ID المستخدم الخاص بك كمدير
TELEGRAM_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}/"

# اسم ملف مفتاح الخدمة
FIREBASE_CONFIG_FILE = 'scmtadmin-firebase-adminsdk-fbsvc-35394bb17a.json'

# تهيئة Firebase
try:
    if not os.path.exists(FIREBASE_CONFIG_FILE):
        logger.error(f"Firebase configuration file '{FIREBASE_CONFIG_FILE}' not found.")
        raise FileNotFoundError
    
    cred = credentials.Certificate(FIREBASE_CONFIG_FILE)
    firebase_admin.initialize_app(cred, {
        'databaseURL': 'https://scmtadmin-default-rtdb.firebaseio.com/'
    })
    logger.info("Firebase initialized successfully")
except Exception as e:
    logger.error(f"Firebase initialization failed: {e}")
    # لن ننهي التطبيق هنا، ولكن لن تعمل الوظائف التي تعتمد على Firebase
    pass

# حالات الجلسة
STATES = {
    'IDLE': 'idle',
    'WAITING_FIRST_NAME': 'waiting_first_name',
    'WAITING_FATHER_NAME': 'waiting_father_name',
    'WAITING_FAMILY_NAME': 'waiting_family_name',
    'WAITING_AGE': 'waiting_age',
    'WAITING_BIRTH_DATE': 'waiting_birth_date',
    'WAITING_MARTYRDOM_DATE': 'waiting_martyrdom_date',
    'WAITING_PLACE': 'waiting_place',
    'WAITING_PHOTO': 'waiting_photo'
}

# دوال Firebase
def is_firebase_ready():
    """التحقق من حالة تهيئة Firebase"""
    return len(firebase_admin._apps) > 0

def save_user_session(user_id, session_data):
    """حفظ جلسة المستخدم"""
    if not is_firebase_ready():
        return False
    try:
        ref = db.reference(f'user_sessions/{user_id}')
        ref.set(session_data)
        return True
    except Exception as e:
        logger.error(f"Error saving session for user {user_id}: {e}")
        return False

def get_user_session(user_id):
    """استرجاع جلسة المستخدم"""
    if not is_firebase_ready():
        return {'state': STATES['IDLE'], 'data': {}}
    try:
        ref = db.reference(f'user_sessions/{user_id}')
        return ref.get() or {'state': STATES['IDLE'], 'data': {}}
    except Exception as e:
        logger.error(f"Error getting session for user {user_id}: {e}")
        return {'state': STATES['IDLE'], 'data': {}}

def clear_user_session(user_id):
    """مسح جلسة المستخدم"""
    if not is_firebase_ready():
        return False
    try:
        ref = db.reference(f'user_sessions/{user_id}')
        ref.delete()
        return True
    except Exception as e:
        logger.error(f"Error clearing session for user {user_id}: {e}")
        return False

def save_request(user_id, request_data):
    """حفظ طلب جديد"""
    if not is_firebase_ready():
        return None
    try:
        pending_ref = db.reference('pending_requests')
        new_request_ref = pending_ref.push(request_data)
        request_id = new_request_ref.key
        
        user_ref = db.reference(f'user_requests/{user_id}/{request_id}')
        user_ref.set(request_data)
        
        return request_id
    except Exception as e:
        logger.error(f"Error saving request for user {user_id}: {e}")
        return None

def update_request_status(request_id, new_status, user_id):
    """تحديث حالة الطلب"""
    if not is_firebase_ready():
        return False
    try:
        pending_ref = db.reference(f'pending_requests/{request_id}')
        user_ref = db.reference(f'user_requests/{user_id}/{request_id}')
        
        updates = {
            'status': new_status,
            'reviewed_at': datetime.now().isoformat()
        }
        
        pending_ref.update(updates)
        user_ref.update(updates)

        if new_status == 'approved':
            # نقل البيانات إلى قاعدة بيانات الشهداء المعتمدة
            martyr_data = db.reference(f'pending_requests/{request_id}/martyr_data').get()
            if martyr_data:
                db.reference('martyrs').push(martyr_data)
                
        # حذف الطلب من قائمة الطلبات المعلقة
        pending_ref.delete()
        return True
    except Exception as e:
        logger.error(f"Error updating request status: {e}")
        return False

# دوال Telegram
def send_telegram_message(chat_id, text=None, reply_markup=None, photo_id=None, photo_caption=None):
    """دالة موحدة لإرسال الرسائل والصور"""
    url = TELEGRAM_API_URL
    payload = {
        'chat_id': chat_id,
        'parse_mode': 'HTML'
    }

    if photo_id:
        url += "sendPhoto"
        payload['photo'] = photo_id
        payload['caption'] = photo_caption
    else:
        url += "sendMessage"
        payload['text'] = text
    
    if reply_markup:
        payload['reply_markup'] = json.dumps(reply_markup)
    
    try:
        response = requests.post(url, data=payload, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Error sending Telegram message/photo to chat {chat_id}: {e}")
        return None

def get_keyboard(buttons):
    """تكوين لوحة مفاتيح تفاعلية"""
    keyboard = [[{'text': btn}] for btn in buttons]
    return {
        'keyboard': keyboard,
        'resize_keyboard': True,
        'one_time_keyboard': False
    }

def get_inline_keyboard(buttons):
    """تكوين لوحة مفاتيح inline"""
    keyboard = [[{'text': btn['text'], 'callback_data': btn['callback_data']}] for btn in buttons]
    return {'inline_keyboard': keyboard}

# معالج الرسائل النصية
def handle_text_message(chat_id, user_id, text, user_info):
    """معالجة الرسائل النصية"""
    
    # أوامر المدير
    if str(user_id) == ADMIN_USER_ID:
        if text == '/review':
            review_pending_requests(chat_id)
        elif text.startswith('/approve'):
            parts = text.split()
            if len(parts) == 3:
                request_id = parts[1]
                user_id_of_request = parts[2]
                approve_request(chat_id, request_id, user_id_of_request)
            else:
                send_telegram_message(chat_id, "صيغة الأمر غير صحيحة. الصيغة الصحيحة: /approve [request_id] [user_id]")
        elif text.startswith('/reject'):
            parts = text.split()
            if len(parts) == 3:
                request_id = parts[1]
                user_id_of_request = parts[2]
                reject_request(chat_id, request_id, user_id_of_request)
            else:
                send_telegram_message(chat_id, "صيغة الأمر غير صحيحة. الصيغة الصحيحة: /reject [request_id] [user_id]")
        else:
            process_user_command(chat_id, user_id, text, user_info)
    else:
        process_user_command(chat_id, user_id, text, user_info)

def process_user_command(chat_id, user_id, text, user_info):
    """معالجة الأوامر العامة للمستخدم"""
    if text == '/start':
        clear_user_session(user_id)
        welcome_text = """🌹 أهلاً وسهلاً بك في بوت معرض شهداء الساحل السوري

رحمهم الله وأسكنهم فسيح جناته

📋 الأوامر المتاحة:
• إضافة شهيد جديد
• عرض طلباتي
• المساعدة

لبدء إضافة شهيد جديد، اضغط على <b>إضافة شهيد جديد</b>"""
        keyboard = get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي', 'مساعدة'])
        send_telegram_message(chat_id, welcome_text, reply_markup=keyboard)
        
    elif text == 'إضافة شهيد جديد' or text == '/upload':
        start_upload_process(chat_id, user_id, user_info)
        
    elif text == 'مساعدة' or text == '/help':
        show_help(chat_id)
        
    elif text == 'عرض طلباتي' or text == '/my_requests':
        show_user_requests(chat_id, user_id)
        
    elif text == 'إلغاء' or text == '/cancel':
        clear_user_session(user_id)
        send_telegram_message(chat_id, "❌ تم إلغاء العملية الحالية\n\nيمكنك البدء من جديد باستخدام <b>إضافة شهيد جديد</b>", reply_markup=get_keyboard(['إضافة شهيد جديد']))
        
    else:
        handle_user_input(chat_id, user_id, text)

def start_upload_process(chat_id, user_id, user_info):
    """بدء عملية إضافة شهيد"""
    if not is_firebase_ready():
        send_telegram_message(chat_id, "عذراً، لا يمكنني الاتصال بقاعدة البيانات حالياً. يرجى المحاولة لاحقاً.")
        return

    session_data = {
        'state': STATES['WAITING_FIRST_NAME'],
        'data': {},
        'user_info': user_info,
        'created_at': datetime.now().isoformat()
    }
    
    if save_user_session(user_id, session_data):
        send_telegram_message(chat_id, "📝 لنبدأ بإضافة شهيد جديد\n\n1️⃣ الرجاء إدخال الاسم الأول:", reply_markup=get_keyboard(['إلغاء']))
    else:
        send_telegram_message(chat_id, "حدث خطأ، يرجى المحاولة مرة أخرى", reply_markup=get_keyboard(['إضافة شهيد جديد']))

def handle_user_input(chat_id, user_id, text):
    """معالجة إدخال المستخدم حسب الحالة"""
    session = get_user_session(user_id)
    
    if session['state'] == STATES['IDLE']:
        send_telegram_message(chat_id, "لا توجد عملية جارية. استخدم <b>إضافة شهيد جديد</b> لبدء الإضافة", reply_markup=get_keyboard(['إضافة شهيد جديد']))
        return
    
    current_state = session['state']
    
    if current_state == STATES['WAITING_FIRST_NAME']:
        if not text.strip():
            send_telegram_message(chat_id, "❌ الرجاء إدخال الاسم الأول")
            return
        session['data']['first_name'] = text.strip()
        session['state'] = STATES['WAITING_FATHER_NAME']
        save_user_session(user_id, session)
        send_telegram_message(chat_id, "2️⃣ الرجاء إدخال اسم الأب:", reply_markup=get_keyboard(['إلغاء']))
        
    elif current_state == STATES['WAITING_FATHER_NAME']:
        if not text.strip():
            send_telegram_message(chat_id, "❌ الرجاء إدخال اسم الأب")
            return
        session['data']['father_name'] = text.strip()
        session['state'] = STATES['WAITING_FAMILY_NAME']
        save_user_session(user_id, session)
        send_telegram_message(chat_id, "3️⃣ الرجاء إدخال اسم العائلة:", reply_markup=get_keyboard(['إلغاء']))
        
    elif current_state == STATES['WAITING_FAMILY_NAME']:
        if not text.strip():
            send_telegram_message(chat_id, "❌ الرجاء إدخال اسم العائلة")
            return
        session['data']['family_name'] = text.strip()
        session['state'] = STATES['WAITING_AGE']
        save_user_session(user_id, session)
        send_telegram_message(chat_id, "4️⃣ الرجاء إدخال عمر الشهيد:", reply_markup=get_keyboard(['إلغاء']))
        
    elif current_state == STATES['WAITING_AGE']:
        try:
            age = int(text)
            if age < 0 or age > 150:
                send_telegram_message(chat_id, "❌ الرجاء إدخال عمر صحيح (0-150)")
                return
        except ValueError:
            send_telegram_message(chat_id, "❌ الرجاء إدخال رقم صحيح للعمر")
            return
        
        session['data']['age'] = age
        session['state'] = STATES['WAITING_BIRTH_DATE']
        save_user_session(user_id, session)
        send_telegram_message(chat_id, "5️⃣ الرجاء إدخال تاريخ الولادة (مثال: 1990/01/15):", reply_markup=get_keyboard(['إلغاء']))
        
    elif current_state == STATES['WAITING_BIRTH_DATE']:
        if not text.strip():
            send_telegram_message(chat_id, "❌ الرجاء إدخال تاريخ الولادة")
            return
        session['data']['birth_date'] = text.strip()
        session['state'] = STATES['WAITING_MARTYRDOM_DATE']
        save_user_session(user_id, session)
        send_telegram_message(chat_id, "6️⃣ الرجاء إدخال تاريخ الاستشهاد (مثال: 2024/03/15):", reply_markup=get_keyboard(['إلغاء']))
        
    elif current_state == STATES['WAITING_MARTYRDOM_DATE']:
        if not text.strip():
            send_telegram_message(chat_id, "❌ الرجاء إدخال تاريخ الاستشهاد")
            return
        session['data']['martyrdom_date'] = text.strip()
        session['state'] = STATES['WAITING_PLACE']
        save_user_session(user_id, session)
        send_telegram_message(chat_id, "7️⃣ الرجاء إدخال مكان الاستشهاد:", reply_markup=get_keyboard(['إلغاء']))
        
    elif current_state == STATES['WAITING_PLACE']:
        if not text.strip():
            send_telegram_message(chat_id, "❌ الرجاء إدخال مكان الاستشهاد")
            return
        session['data']['place'] = text.strip()
        session['state'] = STATES['WAITING_PHOTO']
        save_user_session(user_id, session)
        send_telegram_message(chat_id, "8️⃣ الرجاء إرسال صورة الشهيد:\n\nيمكنك إضافة تعليق على الصورة إذا رغبت", reply_markup=get_keyboard(['إلغاء']))

def handle_photo_message(chat_id, user_id, photo_data, caption=""):
    """معالجة الصور"""
    session = get_user_session(user_id)
    
    if session['state'] != STATES['WAITING_PHOTO']:
        send_telegram_message(chat_id, "📸 يرجى اتباع الخطوات بالترتيب\n\nاستخدم <b>إضافة شهيد جديد</b> لبدء الإضافة", reply_markup=get_keyboard(['إضافة شهيد جديد']))
        return
    
    photo = photo_data[-1]
    photo_file_id = photo['file_id']
    session['data']['photo_file_id'] = photo_file_id
    session['data']['photo_caption'] = caption
    
    complete_request(chat_id, user_id, session)

def complete_request(chat_id, user_id, session):
    """إكمال الطلب وحفظه"""
    martyr_data = session['data']
    full_name = f"{martyr_data.get('first_name', '')} {martyr_data.get('father_name', '')} {martyr_data.get('family_name', '')}"
    
    request_data = {
        'martyr_data': {
            **martyr_data,
            'full_name': full_name,
            'timestamp': datetime.now().isoformat()
        },
        'user_info': session['user_info'],
        'status': 'pending',
        'created_at': datetime.now().isoformat()
    }
    
    request_id = save_request(user_id, request_data)
    
    if request_id:
        clear_user_session(user_id)
        
        message_summary = f"""✅ تم إرسال طلبك بنجاح!

📋 ملخص البيانات:
👤 الاسم: {full_name}
🎂 العمر: {martyr_data.get('age', 'غير متوفر')}
📅 الولادة: {martyr_data.get('birth_date', 'غير متوفر')}
🕊️ الاستشهاد: {martyr_data.get('martyrdom_date', 'غير متوفر')}
📍 المكان: {martyr_data.get('place', 'غير متوفر')}

⏳ سيتم مراجعة طلبك من قبل الإدارة
📱 يمكنك متابعة حالة طلبك باستخدام <b>عرض طلباتي</b>"""
        
        photo_file_id = martyr_data.get('photo_file_id')
        if photo_file_id:
            send_telegram_message(chat_id, photo_caption=message_summary, photo_id=photo_file_id, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))
            
            # إرسال إشعار للمدير
            admin_notification_text = f"<b>⭐️ طلب جديد للمراجعة ⭐️</b>\n\n<b>ID الطلب:</b> <code>{request_id}</code>\n<b>ID المستخدم:</b> <code>{user_id}</code>\n<b>الاسم:</b> {full_name}\n\nيمكنك مراجعة الطلب باستخدام /review"
            send_telegram_message(ADMIN_USER_ID, admin_notification_text)
        else:
            send_telegram_message(chat_id, text=message_summary, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))
            
            # إرسال إشعار للمدير (بدون صورة)
            admin_notification_text = f"<b>⭐️ طلب جديد للمراجعة ⭐️</b>\n\n<b>ID الطلب:</b> <code>{request_id}</code>\n<b>ID المستخدم:</b> <code>{user_id}</code>\n<b>الاسم:</b> {full_name}\n\nيمكنك مراجعة الطلب باستخدام /review"
            send_telegram_message(ADMIN_USER_ID, admin_notification_text)

    else:
        send_telegram_message(chat_id, "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى", reply_markup=get_keyboard(['إضافة شهيد جديد']))

# --- دوال الإدارة ---
def review_pending_requests(chat_id):
    """دالة مراجعة الطلبات المعلقة"""
    if not is_firebase_ready():
        send_telegram_message(chat_id, "عذراً، لا يمكنني الاتصال بقاعدة البيانات حالياً.")
        return

    try:
        ref = db.reference('pending_requests')
        requests_data = ref.get()

        if not requests_data:
            send_telegram_message(chat_id, "لا توجد طلبات معلقة للمراجعة في الوقت الحالي.")
            return

        for request_id, request_info in requests_data.items():
            martyr_data = request_info.get('martyr_data', {})
            user_info = request_info.get('user_info', {})
            user_id = user_info.get('telegram_id', 'غير معروف')

            summary = f"<b>طلب جديد للمراجعة</b>\n\n<b>ID:</b> <code>{request_id}</code>\n<b>الاسم:</b> {martyr_data.get('full_name', 'غير محدد')}\n<b>العمر:</b> {martyr_data.get('age', 'غير متوفر')}\n<b>تاريخ الولادة:</b> {martyr_data.get('birth_date', 'غير متوفر')}\n<b>تاريخ الاستشهاد:</b> {martyr_data.get('martyrdom_date', 'غير متوفر')}\n<b>مكان الاستشهاد:</b> {martyr_data.get('place', 'غير متوفر')}\n\n<b>مقدم الطلب:</b> {user_info.get('first_name', '')} {user_info.get('last_name', '')} (@{user_info.get('username', '')})\n<b>ID المستخدم:</b> <code>{user_id}</code>"

            photo_id = martyr_data.get('photo_file_id')
            
            # إنشاء لوحة مفاتيح للقبول والرفض
            inline_keyboard = get_inline_keyboard([
                {'text': '✅ قبول', 'callback_data': f'approve_{request_id}_{user_id}'},
                {'text': '❌ رفض', 'callback_data': f'reject_{request_id}_{user_id}'}
            ])

            if photo_id:
                send_telegram_message(chat_id, photo_id=photo_id, photo_caption=summary, reply_markup=inline_keyboard)
            else:
                send_telegram_message(chat_id, text=summary, reply_markup=inline_keyboard)
    
    except Exception as e:
        logger.error(f"Error reviewing pending requests: {e}")
        send_telegram_message(chat_id, "حدث خطأ أثناء محاولة مراجعة الطلبات.")

def approve_request(chat_id, request_id, user_id):
    """دالة لقبول طلب"""
    if update_request_status(request_id, 'approved', user_id):
        send_telegram_message(chat_id, f"✅ تم قبول الطلب <code>{request_id}</code> بنجاح.")
        send_telegram_message(user_id, f"<b>🎉 تهانينا!</b>\n\nتم قبول طلبك لإضافة الشهيد {db.reference(f'user_requests/{user_id}/{request_id}/martyr_data/full_name').get()}.\n\nشكراً لك!")
    else:
        send_telegram_message(chat_id, f"❌ حدث خطأ في قبول الطلب <code>{request_id}</code>.")

def reject_request(chat_id, request_id, user_id):
    """دالة لرفض طلب"""
    if update_request_status(request_id, 'rejected', user_id):
        send_telegram_message(chat_id, f"❌ تم رفض الطلب <code>{request_id}</code> بنجاح.")
        send_telegram_message(user_id, f"<b>😔 عذراً،</b>\n\nتم رفض طلبك لإضافة الشهيد {db.reference(f'user_requests/{user_id}/{request_id}/martyr_data/full_name').get()}.\n\nيمكنك تقديم طلب جديد بعد مراجعة البيانات.")
    else:
        send_telegram_message(chat_id, f"❌ حدث خطأ في رفض الطلب <code>{request_id}</code>.")

# Routes Flask
@app.route('/', methods=['GET'])
def health_check():
    """فحص صحة الخدمة"""
    return jsonify({
        'status': 'ok',
        'message': 'Bot is running!',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/webhook', methods=['POST'])
def webhook():
    """استقبال التحديثات من Telegram"""
    try:
        update = request.get_json()
        logger.info(f"Received update: {update}")
        
        if 'message' in update:
            message = update['message']
            chat_id = message['chat']['id']
            user_id = str(message['from']['id'])
            
            user_info = {
                'telegram_id': user_id,
                'first_name': message['from'].get('first_name', ''),
                'last_name': message['from'].get('last_name', ''),
                'username': message['from'].get('username', '')
            }
            
            if 'text' in message:
                handle_text_message(chat_id, user_id, message['text'], user_info)
            elif 'photo' in message:
                caption = message.get('caption', '')
                handle_photo_message(chat_id, user_id, message['photo'], caption)

        elif 'callback_query' in update:
            callback_query = update['callback_query']
            callback_data = callback_query['data']
            chat_id = callback_query['message']['chat']['id']
            user_id = str(callback_query['from']['id'])

            if str(user_id) == ADMIN_USER_ID:
                handle_callback_query(chat_id, callback_data)
        
        return jsonify({'status': 'ok'})
        
    except Exception as e:
        logger.error(f"Error processing update: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

def handle_callback_query(chat_id, callback_data):
    """معالجة استدعاءات لوحة المفاتيح inline"""
    try:
        parts = callback_data.split('_')
        action = parts[0]
        request_id = parts[1]
        user_id_of_request = parts[2]
        
        if action == 'approve':
            approve_request(chat_id, request_id, user_id_of_request)
        elif action == 'reject':
            reject_request(chat_id, request_id, user_id_of_request)
            
    except Exception as e:
        logger.error(f"Error handling callback query: {e}")
        send_telegram_message(chat_id, "حدث خطأ في معالجة طلبك.")


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
