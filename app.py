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
firebase_initialized = False
try:
    if not os.path.exists(FIREBASE_CONFIG_FILE):
        logger.error(f"Firebase configuration file '{FIREBASE_CONFIG_FILE}' not found.")
        raise FileNotFoundError(f"Firebase configuration file not found: {FIREBASE_CONFIG_FILE}")
    
    # التحقق من أن الملف غير فارغ وصالح
    with open(FIREBASE_CONFIG_FILE, 'r') as f:
        config_data = json.load(f)
        if not config_data.get('private_key') or not config_data.get('client_email'):
            raise ValueError("Invalid Firebase configuration: missing required keys")
    
    cred = credentials.Certificate(FIREBASE_CONFIG_FILE)
    firebase_admin.initialize_app(cred, {
        'databaseURL': 'https://scmtadmin-default-rtdb.firebaseio.com/'
    })
    firebase_initialized = True
    logger.info("Firebase initialized successfully")
except Exception as e:
    logger.error(f"Firebase initialization failed: {e}")
    firebase_initialized = False

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

# متغيرات لتخزين الجلسات في الذاكرة كبديل عن Firebase
user_sessions = {}
pending_requests = {}
user_requests = {}

# دوال Firebase المحسنة
def is_firebase_ready():
    """التحقق من حالة تهيئة Firebase"""
    return firebase_initialized and len(firebase_admin._apps) > 0

def save_user_session(user_id, session_data):
    """حفظ جلسة المستخدم"""
    try:
        if is_firebase_ready():
            ref = db.reference(f'user_sessions/{user_id}')
            ref.set(session_data)
            logger.info(f"Session saved to Firebase for user {user_id}")
        else:
            # حفظ في الذاكرة كبديل
            user_sessions[user_id] = session_data
            logger.info(f"Session saved to memory for user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Error saving session for user {user_id}: {e}")
        # حفظ في الذاكرة كبديل
        user_sessions[user_id] = session_data
        return True

def get_user_session(user_id):
    """استرجاع جلسة المستخدم"""
    try:
        if is_firebase_ready():
            ref = db.reference(f'user_sessions/{user_id}')
            session = ref.get()
            if session:
                return session
        
        # استرجاع من الذاكرة
        return user_sessions.get(user_id, {'state': STATES['IDLE'], 'data': {}})
    except Exception as e:
        logger.error(f"Error getting session for user {user_id}: {e}")
        return user_sessions.get(user_id, {'state': STATES['IDLE'], 'data': {}})

def clear_user_session(user_id):
    """مسح جلسة المستخدم"""
    try:
        if is_firebase_ready():
            ref = db.reference(f'user_sessions/{user_id}')
            ref.delete()
            logger.info(f"Session cleared from Firebase for user {user_id}")
        
        # مسح من الذاكرة أيضاً
        if user_id in user_sessions:
            del user_sessions[user_id]
        return True
    except Exception as e:
        logger.error(f"Error clearing session for user {user_id}: {e}")
        # مسح من الذاكرة فقط
        if user_id in user_sessions:
            del user_sessions[user_id]
        return True

def save_request(user_id, request_data):
    """حفظ طلب جديد"""
    request_id = f"req_{user_id}_{int(datetime.now().timestamp())}"
    
    try:
        if is_firebase_ready():
            pending_ref = db.reference('pending_requests')
            new_request_ref = pending_ref.child(request_id)
            new_request_ref.set(request_data)
            
            user_ref = db.reference(f'user_requests/{user_id}/{request_id}')
            user_ref.set(request_data)
            logger.info(f"Request saved to Firebase: {request_id}")
        else:
            # حفظ في الذاكرة
            if 'pending_requests' not in globals():
                globals()['pending_requests'] = {}
            if user_id not in user_requests:
                user_requests[user_id] = {}
            
            pending_requests[request_id] = request_data
            user_requests[user_id][request_id] = request_data
            logger.info(f"Request saved to memory: {request_id}")
        
        return request_id
    except Exception as e:
        logger.error(f"Error saving request for user {user_id}: {e}")
        # حفظ في الذاكرة كبديل
        if 'pending_requests' not in globals():
            globals()['pending_requests'] = {}
        if user_id not in user_requests:
            user_requests[user_id] = {}
        
        pending_requests[request_id] = request_data
        user_requests[user_id][request_id] = request_data
        return request_id

def update_request_status(request_id, new_status, user_id):
    """تحديث حالة الطلب"""
    try:
        updates = {
            'status': new_status,
            'reviewed_at': datetime.now().isoformat()
        }
        
        if is_firebase_ready():
            pending_ref = db.reference(f'pending_requests/{request_id}')
            user_ref = db.reference(f'user_requests/{user_id}/{request_id}')
            
            # تحديث الحالة
            pending_ref.update(updates)
            user_ref.update(updates)

            if new_status == 'approved':
                # نقل البيانات إلى قاعدة بيانات الشهداء المعتمدة
                martyr_data = pending_ref.child('martyr_data').get()
                if martyr_data:
                    db.reference('martyrs').push(martyr_data)
                    
            # حذف الطلب من قائمة الطلبات المعلقة
            pending_ref.delete()
        else:
            # تحديث في الذاكرة
            if request_id in pending_requests:
                pending_requests[request_id].update(updates)
                
                if new_status == 'approved':
                    # يمكن إضافة المزيد من المعالجة هنا للطلبات المقبولة
                    pass
                
                # حذف من الطلبات المعلقة
                del pending_requests[request_id]
            
            if user_id in user_requests and request_id in user_requests[user_id]:
                user_requests[user_id][request_id].update(updates)
        
        return True
    except Exception as e:
        logger.error(f"Error updating request status: {e}")
        return False

# دوال Telegram المحسنة
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
        if photo_caption:
            payload['caption'] = photo_caption
    else:
        url += "sendMessage"
        payload['text'] = text or "رسالة فارغة"
    
    if reply_markup:
        payload['reply_markup'] = json.dumps(reply_markup)
    
    try:
        response = requests.post(url, data=payload, timeout=10)
        response.raise_for_status()
        result = response.json()
        if result.get('ok'):
            logger.info(f"Message sent successfully to chat {chat_id}")
        else:
            logger.error(f"Telegram API error: {result}")
        return result
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
            return
        elif text.startswith('/approve'):
            parts = text.split()
            if len(parts) == 3:
                request_id = parts[1]
                user_id_of_request = parts[2]
                approve_request(chat_id, request_id, user_id_of_request)
            else:
                send_telegram_message(chat_id, "صيغة الأمر غير صحيحة. الصيغة الصحيحة: /approve [request_id] [user_id]")
            return
        elif text.startswith('/reject'):
            parts = text.split()
            if len(parts) == 3:
                request_id = parts[1]
                user_id_of_request = parts[2]
                reject_request(chat_id, request_id, user_id_of_request)
            else:
                send_telegram_message(chat_id, "صيغة الأمر غير صحيحة. الصيغة الصحيحة: /reject [request_id] [user_id]")
            return
    
    # معالجة الأوامر العامة
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

def show_help(chat_id):
    """عرض رسالة المساعدة"""
    help_text = """📖 مساعدة بوت معرض شهداء الساحل السوري

🔹 <b>إضافة شهيد جديد:</b>
يمكنك إضافة شهيد جديد باتباع الخطوات التالية:
1. الاسم الأول
2. اسم الأب  
3. اسم العائلة
4. العمر
5. تاريخ الولادة
6. تاريخ الاستشهاد
7. مكان الاستشهاد
8. صورة الشهيد

🔹 <b>عرض طلباتي:</b>
يمكنك مشاهدة حالة جميع طلباتك المقدمة

🔹 <b>إلغاء:</b>
يمكنك إلغاء العملية الحالية في أي وقت

📞 للمساعدة الإضافية، تواصل مع المدير: @DevYouns"""
    
    send_telegram_message(chat_id, help_text, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))

def show_user_requests(chat_id, user_id):
    """عرض طلبات المستخدم"""
    try:
        user_reqs = {}
        
        if is_firebase_ready():
            ref = db.reference(f'user_requests/{user_id}')
            user_reqs = ref.get() or {}
        else:
            user_reqs = user_requests.get(user_id, {})
        
        if not user_reqs:
            send_telegram_message(chat_id, "📭 لا توجد طلبات مقدمة من قبلك حتى الآن", reply_markup=get_keyboard(['إضافة شهيد جديد']))
            return
        
        requests_text = "<b>📋 طلباتك المقدمة:</b>\n\n"
        for req_id, req_data in user_reqs.items():
            martyr_name = req_data.get('martyr_data', {}).get('full_name', 'غير محدد')
            status = req_data.get('status', 'pending')
            created_at = req_data.get('created_at', 'غير محدد')
            
            status_emoji = {
                'pending': '⏳',
                'approved': '✅', 
                'rejected': '❌'
            }.get(status, '❓')
            
            status_text = {
                'pending': 'قيد المراجعة',
                'approved': 'تم القبول',
                'rejected': 'تم الرفض'
            }.get(status, 'غير معروف')
            
            requests_text += f"{status_emoji} <b>{martyr_name}</b>\n"
            requests_text += f"   الحالة: {status_text}\n"
            requests_text += f"   التاريخ: {created_at[:10] if created_at != 'غير محدد' else 'غير محدد'}\n\n"
        
        send_telegram_message(chat_id, requests_text, reply_markup=get_keyboard(['إضافة شهيد جديد', 'مساعدة']))
        
    except Exception as e:
        logger.error(f"Error showing user requests: {e}")
        send_telegram_message(chat_id, "حدث خطأ في عرض طلباتك", reply_markup=get_keyboard(['إضافة شهيد جديد']))

def start_upload_process(chat_id, user_id, user_info):
    """بدء عملية إضافة شهيد"""
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
    
    photo = photo_data[-1]  # أخذ أعلى دقة
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
        else:
            send_telegram_message(chat_id, text=message_summary, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))
        
        # إرسال إشعار للمدير
        admin_notification_text = f"<b>⭐️ طلب جديد للمراجعة ⭐️</b>\n\n<b>ID الطلب:</b> <code>{request_id}</code>\n<b>ID المستخدم:</b> <code>{user_id}</code>\n<b>الاسم:</b> {full_name}\n\n<b>مقدم الطلب:</b> {session['user_info'].get('first_name', '')} {session['user_info'].get('last_name', '')} (@{session['user_info'].get('username', '')})\n\nيمكنك مراجعة الطلب باستخدام /review"
        send_telegram_message(ADMIN_USER_ID, admin_notification_text)

    else:
        send_telegram_message(chat_id, "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى", reply_markup=get_keyboard(['إضافة شهيد جديد']))

# --- دوال الإدارة ---
def review_pending_requests(chat_id):
    """دالة مراجعة الطلبات المعلقة"""
    try:
        requests_data = {}
        
        if is_firebase_ready():
            ref = db.reference('pending_requests')
            requests_data = ref.get() or {}
        else:
            requests_data = pending_requests

        if not requests_data:
            send_telegram_message(chat_id, "لا توجد طلبات معلقة للمراجعة في الوقت الحالي.")
            return

        for request_id, request_info in requests_data.items():
            martyr_data = request_info.get('martyr_data', {})
            user_info = request_info.get('user_info', {})
            user_id_req = user_info.get('telegram_id', 'غير معروف')

            summary = f"<b>طلب جديد للمراجعة</b>\n\n<b>ID:</b> <code>{request_id}</code>\n<b>الاسم:</b> {martyr_data.get('full_name', 'غير محدد')}\n<b>العمر:</b> {martyr_data.get('age', 'غير متوفر')}\n<b>تاريخ الولادة:</b> {martyr_data.get('birth_date', 'غير متوفر')}\n<b>تاريخ الاستشهاد:</b> {martyr_data.get('martyrdom_date', 'غير متوفر')}\n<b>مكان الاستشهاد:</b> {martyr_data.get('place', 'غير متوفر')}\n\n<b>مقدم الطلب:</b> {user_info.get('first_name', '')} {user_info.get('last_name', '')} (@{user_info.get('username', '')})\n<b>ID المستخدم:</b> <code>{user_id_req}</code>"

            photo_id = martyr_data.get('photo_file_id')
            
            # إنشاء لوحة مفاتيح للقبول والرفض
            inline_keyboard = get_inline_keyboard([
                {'text': '✅ قبول', 'callback_data': f'approve_{request_id}_{user_id_req}'},
                {'text': '❌ رفض', 'callback_data': f'reject_{request_id}_{user_id_req}'}
            ])

            if photo_id:
                send_telegram_message(chat_id, photo_id=photo_id, photo_caption=summary, reply_markup=inline_keyboard)
            else:
                send_telegram_message(chat_id, text=summary, reply_markup=inline_keyboard)
    
    except Exception as e:
        logger.error(f"Error reviewing pending requests: {e}")
        send_telegram_message(chat_id, "حدث خطأ أثناء محاولة مراجعة الطلبات.")

def approve_request(chat_id, request_id, user_id_req):
    """دالة لقبول طلب"""
    try:
        # الحصول على بيانات الطلب أولاً
        martyr_name = "غير محدد"
        if is_firebase_ready():
            ref = db.reference(f'user_requests/{user_id_req}/{request_id}/martyr_data/full_name')
            martyr_name = ref.get() or "غير محدد"
        else:
            if user_id_req in user_requests and request_id in user_requests[user_id_req]:
                martyr_name = user_requests[user_id_req][request_id].get('martyr_data', {}).get('full_name', 'غير محدد')
        
        if update_request_status(request_id, 'approved', user_id_req):
            send_telegram_message(chat_id, f"✅ تم قبول الطلب <code>{request_id}</code> بنجاح.")
            send_telegram_message(user_id_req, f"<b>🎉 تهانينا!</b>\n\nتم قبول طلبك لإضافة الشهيد <b>{martyr_name}</b>.\n\nشكراً لك على مساهمتك في حفظ ذكرى شهدائنا الأبرار.")
        else:
            send_telegram_message(chat_id, f"❌ حدث خطأ في قبول الطلب <code>{request_id}</code>.")
    except Exception as e:
        logger.error(f"Error approving request: {e}")
        send_telegram_message(chat_id, f"❌ حدث خطأ في قبول الطلب <code>{request_id}</code>.")

def reject_request(chat_id, request_id, user_id_req):
    """دالة لرفض طلب"""
    try:
        # الحصول على بيانات الطلب أولاً
        martyr_name = "غير محدد"
        if is_firebase_ready():
            ref = db.reference(f'user_requests/{user_id_req}/{request_id}/martyr_data/full_name')
            martyr_name = ref.get() or "غير محدد"
        else:
            if user_id_req in user_requests and request_id in user_requests[user_id_req]:
                martyr_name = user_requests[user_id_req][request_id].get('martyr_data', {}).get('full_name', 'غير محدد')
        
        if update_request_status(request_id, 'rejected', user_id_req):
            send_telegram_message(chat_id, f"❌ تم رفض الطلب <code>{request_id}</code> بنجاح.")
            send_telegram_message(user_id_req, f"<b>😔 عذراً،</b>\n\nتم رفض طلبك لإضافة الشهيد <b>{martyr_name}</b>.\n\nيمكنك تقديم طلب جديد بعد مراجعة البيانات والتأكد من صحتها.\n\nللاستفسار تواصل مع: @DevYouns")
        else:
            send_telegram_message(chat_id, f"❌ حدث خطأ في رفض الطلب <code>{request_id}</code>.")
    except Exception as e:
        logger.error(f"Error rejecting request: {e}")
        send_telegram_message(chat_id, f"❌ حدث خطأ في رفض الطلب <code>{request_id}</code>.")

def handle_callback_query(chat_id, callback_data):
    """معالجة استدعاءات لوحة المفاتيح inline"""
    try:
        parts = callback_data.split('_')
        if len(parts) < 3:
            send_telegram_message(chat_id, "❌ بيانات غير صحيحة")
            return
            
        action = parts[0]
        request_id = parts[1]
        user_id_of_request = parts[2]
        
        if action == 'approve':
            approve_request(chat_id, request_id, user_id_of_request)
        elif action == 'reject':
            reject_request(chat_id, request_id, user_id_of_request)
        else:
            send_telegram_message(chat_id, "❌ عمل غير مدعوم")
            
    except Exception as e:
        logger.error(f"Error handling callback query: {e}")
        send_telegram_message(chat_id, "حدث خطأ في معالجة طلبك.")

# Routes Flask
@app.route('/', methods=['GET'])
def health_check():
    """فحص صحة الخدمة"""
    status_info = {
        'status': 'ok',
        'message': 'Bot is running!',
        'timestamp': datetime.now().isoformat(),
        'firebase_status': 'connected' if is_firebase_ready() else 'disconnected',
        'admin_id': ADMIN_USER_ID
    }
    return jsonify(status_info)

@app.route('/webhook', methods=['POST'])
def webhook():
    """استقبال التحديثات من Telegram"""
    try:
        update = request.get_json()
        logger.info(f"Received update: {json.dumps(update, indent=2)}")
        
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
            else:
                send_telegram_message(chat_id, "نوع الرسالة غير مدعوم. يرجى إرسال نص أو صورة فقط.")

        elif 'callback_query' in update:
            callback_query = update['callback_query']
            callback_data = callback_query['data']
            chat_id = callback_query['message']['chat']['id']
            user_id = str(callback_query['from']['id'])

            # التحقق من أن المستخدم هو المدير
            if str(user_id) == ADMIN_USER_ID:
                handle_callback_query(chat_id, callback_data)
                
                # الرد على callback query لإزالة "loading" من الزر
                try:
                    answer_url = f"{TELEGRAM_API_URL}answerCallbackQuery"
                    requests.post(answer_url, json={'callback_query_id': callback_query['id']})
                except:
                    pass
            else:
                # الرد على callback query وإخبار المستخدم أنه غير مخول
                try:
                    answer_url = f"{TELEGRAM_API_URL}answerCallbackQuery"
                    requests.post(answer_url, json={
                        'callback_query_id': callback_query['id'],
                        'text': 'غير مسموح لك بهذا العمل',
                        'show_alert': True
                    })
                except:
                    pass
        
        return jsonify({'status': 'ok'})
        
    except Exception as e:
        logger.error(f"Error processing update: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/set_webhook', methods=['GET'])
def set_webhook():
    """تعيين webhook للبوت"""
    webhook_url = "https://smgallery.onrender.com/webhook"
    
    try:
        url = f"{TELEGRAM_API_URL}setWebhook"
        payload = {'url': webhook_url}
        response = requests.post(url, json=payload)
        result = response.json()
        
        if result.get('ok'):
            return jsonify({
                'status': 'success',
                'message': 'Webhook set successfully',
                'webhook_url': webhook_url,
                'result': result
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Failed to set webhook',
                'error': result
            }), 400
            
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Error setting webhook: {str(e)}'
        }), 500

@app.route('/webhook_info', methods=['GET'])
def webhook_info():
    """معلومات webhook الحالي"""
    try:
        url = f"{TELEGRAM_API_URL}getWebhookInfo"
        response = requests.get(url)
        result = response.json()
        
        return jsonify({
            'status': 'ok',
            'webhook_info': result
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Error getting webhook info: {str(e)}'
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
