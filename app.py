import os
import json
import logging
from datetime import datetime
from flask import Flask, request, jsonify
import requests
import firebase_admin
from firebase_admin import credentials, db

# إعداد التسجيل
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# إعداد Flask
app = Flask(__name__)

# إعدادات البوت
BOT_TOKEN = "8272634262:AAHXUYw_Q-0fwuyFAc5j6ntgtZHt3VyWCOM"
ADMIN_USER_ID = "5679396406"
TELEGRAM_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}/"

# إعداد Firebase
FIREBASE_CONFIG = {
    "type": "service_account",
    "project_id": "scmtadmin",
    "private_key_id": "c1515ad2504f8524f044e83f23eac3ec1085ad29",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCt7Z1LHO4SwIjl\nQ6uO1y+skar15BvPEGnfjNsGyLXdmA4HelIh0kz91ltT3dG70gjpaZc7xuAFlbOO\nw0Y789H4abWKPlS5W5WK3CcviOnBrO5pn2G80ybZa/kLF0atfBtF6oOH5yf/FJrZ\nwCcxSqeutG7/TyQ0dRP5YsMvH81+hWRjpi+289mrGrJrBWDB1ItnIT9MhnpV/uQb\nz0V9gTSLCKUFX3EzqN+S3Svy8xk8180vVPP+dIigLUp3QEfWXNmDDvlgFSFocF9X\n1BR8rAlYd2jLVt1Ww0rfsGzOZjTc6mVJll5wImq01XqKv7NmpARllo6yGg0sJmHi\n1+mBAC4PAgMBAAECggEAEPZABW1C19f9rG4sXaJ6vGz7AT6dFP/YHhG8jS18dFSP\nObIiLw41V/lUWsTNNBtIUeBsUUtp2Yw/QJ2modN7bKsn0IhCTE60MiCaPwvZJXwv\nRrm2bGsjOhz04rIDFd7T7L5G1DV6NGmBWIRheMXREzv21ItBT/mtraqGDSMgL/Bk\n4XE2qevrzaf8Mv+6ZkxH12sZ4ixY5S4mkJpxLBX4KTPo/mKi3v/ZDzE0/Q8OxjPQ\n5JiJEJ0rABqze6X9e7pjBYhIa1IOTAmjytgCUALWB8GpdJaeC7ye0lViEhtjDapw\ncgPr7lSqw1NbTI8uYevGwS5/1C7eSVhWi96659h5oQKBgQDulhzbwpb9bTlp5s4B\nwREx3SO+p0Q7e8ABx6n4HIjKo25xLFOO14vExyWlN6auVBqxWhEuCk+ELxtlFUge\nCGo1IU9DX0E+8MwrdUl+DsD86EQa3mhbFgxUFEr1+DDm2PtYoVTop2C4jJIZwxTO\ntBluJHl5VqUX0v+5R6tFjU30+QKBgQC6n2Pi5xg+vRnK0ETTo89cRldHV/i3b0kf\nGdAn65eo0rDyCk0fT22BKNGpP2wYBshOhnX8+AispS3X/ZZ+EC0QiBGOmxIk7Uvu\nEHpprLQzBt69zOKnb4ZXsASLH+ct4Fv3QAUWT73+a7yHy9Bfg1MLcP61YvxgVoJV\ncflkslNlRwKBgH3nCWOO1E74DIwuGBgk4gYGRI6fhgo9y50k2DTuGeGVTPq8AXwn\nksJMtTjynSrxhwSAGwDIwB1pHnPBP0VZ+3H+Ge3bnnqwZ42nXxj+gCj2CLqFE1y9\nzdOwwb37MxMe/cRPnpcHfKrmw1KE9738nE7bQJ8fcg+YcQo9H8ycPL9BAoGAadVm\nYhFIMJww+lFuFs+5Es1ZRb5f8DcOMrMC1wDGOxlw+3JYFj+HDE5HyEGNXXrLMa0T\nUGihEreB7hGDvO4TgGKKAmNywLpJ6zIxGai1cJKe0uhUSTv35daOXQ+0nNG1ldwa\nhnKmfpg+jIxLGT9yYvSrndYK5d9pfmdqVW7D2JUCgYB6gG63FdlF9ibagO+1te1s\n5x2oF8bDI95U25BvaCeY03WUO1AUySVRknkAGt5qgYZF7gPYcyjmSMTHeIsY+RaC\nBG6obeZCVpLJvHuoowvD510y1d5sys06pr34BLQQBbVI9uhS7lBFxOG8JbKm7clf\nEG72La03nAGCyTNAPHa/4Q==\n-----END PRIVATE KEY-----\n",
    "client_email": "firebase-adminsdk-fbsvc@scmtadmin.iam.gserviceaccount.com",
    "client_id": "105793644642190107218",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40scmtadmin.iam.gserviceaccount.com",
    "universe_domain": "googleapis.com"
}

# تهيئة Firebase
try:
    cred = credentials.Certificate(FIREBASE_CONFIG)
    firebase_admin.initialize_app(cred, {
        'databaseURL': 'https://scmtadmin-default-rtdb.firebaseio.com/'
    })
    logger.info("Firebase initialized successfully")
except Exception as e:
    logger.error(f"Firebase initialization failed: {e}")

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
def save_user_session(user_id, session_data):
    """حفظ جلسة المستخدم"""
    try:
        ref = db.reference(f'user_sessions/{user_id}')
        ref.set(session_data)
        return True
    except Exception as e:
        logger.error(f"Error saving session: {e}")
        return False

def get_user_session(user_id):
    """استرجاع جلسة المستخدم"""
    try:
        ref = db.reference(f'user_sessions/{user_id}')
        return ref.get() or {'state': STATES['IDLE'], 'data': {}}
    except Exception as e:
        logger.error(f"Error getting session: {e}")
        return {'state': STATES['IDLE'], 'data': {}}

def clear_user_session(user_id):
    """مسح جلسة المستخدم"""
    try:
        ref = db.reference(f'user_sessions/{user_id}')
        ref.delete()
        return True
    except Exception as e:
        logger.error(f"Error clearing session: {e}")
        return False

def save_request(user_id, request_data):
    """حفظ طلب جديد"""
    try:
        # حفظ في الطلبات المعلقة
        pending_ref = db.reference('pending_requests')
        new_request_ref = pending_ref.push(request_data)
        request_id = new_request_ref.key
        
        # حفظ في طلبات المستخدم
        user_ref = db.reference(f'user_requests/{user_id}/{request_id}')
        user_ref.set(request_data)
        
        return request_id
    except Exception as e:
        logger.error(f"Error saving request: {e}")
        return None

# دوال Telegram
def send_message(chat_id, text, reply_markup=None):
    """إرسال رسالة"""
    url = TELEGRAM_API_URL + "sendMessage"
    data = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'HTML'
    }
    if reply_markup:
        data['reply_markup'] = json.dumps(reply_markup)
    
    try:
        response = requests.post(url, data=data, timeout=10)
        return response.json()
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        return None

def send_photo(chat_id, photo, caption="", reply_markup=None):
    """إرسال صورة"""
    url = TELEGRAM_API_URL + "sendPhoto"
    data = {
        'chat_id': chat_id,
        'photo': photo,
        'caption': caption,
        'parse_mode': 'HTML'
    }
    if reply_markup:
        data['reply_markup'] = json.dumps(reply_markup)
    
    try:
        response = requests.post(url, data=data, timeout=10)
        return response.json()
    except Exception as e:
        logger.error(f"Error sending photo: {e}")
        return None
        
def get_file_url(file_id):
    """الحصول على رابط ملف من Telegram"""
    url = TELEGRAM_API_URL + "getFile"
    data = {'file_id': file_id}
    try:
        response = requests.get(url, data=data, timeout=10)
        file_path = response.json()['result']['file_path']
        return f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
    except Exception as e:
        logger.error(f"Error getting file URL: {e}")
        return None

def get_keyboard(buttons):
    """تكوين لوحة مفاتيح تفاعلية"""
    keyboard = [[{'text': btn}] for btn in buttons]
    return {
        'keyboard': keyboard,
        'resize_keyboard': True,
        'one_time_keyboard': True
    }

# معالج الرسائل النصية
def handle_text_message(chat_id, user_id, text, user_info):
    """معالجة الرسائل النصية"""
    
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
        send_message(chat_id, welcome_text, reply_markup=keyboard)
        
    elif text == 'إضافة شهيد جديد' or text == '/upload':
        start_upload_process(chat_id, user_id, user_info)
        
    elif text == 'مساعدة' or text == '/help':
        show_help(chat_id)
        
    elif text == 'عرض طلباتي' or text == '/my_requests':
        show_user_requests(chat_id, user_id)
        
    elif text == 'إلغاء' or text == '/cancel':
        clear_user_session(user_id)
        send_message(chat_id, "❌ تم إلغاء العملية الحالية\n\nيمكنك البدء من جديد باستخدام <b>إضافة شهيد جديد</b>", reply_markup=get_keyboard(['إضافة شهيد جديد']))
        
    else:
        handle_user_input(chat_id, user_id, text)

def start_upload_process(chat_id, user_id, user_info):
    """بدء عملية إضافة شهيد"""
    session_data = {
        'state': STATES['WAITING_FIRST_NAME'],
        'data': {},
        'user_info': user_info,
        'created_at': datetime.now().isoformat()
    }
    
    if save_user_session(user_id, session_data):
        send_message(chat_id, "📝 لنبدأ بإضافة شهيد جديد\n\n1️⃣ الرجاء إدخال الاسم الأول:", reply_markup=get_keyboard(['إلغاء']))
    else:
        send_message(chat_id, "حدث خطأ، يرجى المحاولة مرة أخرى", reply_markup=get_keyboard(['إضافة شهيد جديد']))

def handle_user_input(chat_id, user_id, text):
    """معالجة إدخال المستخدم حسب الحالة"""
    session = get_user_session(user_id)
    
    if session['state'] == STATES['IDLE']:
        send_message(chat_id, "لا توجد عملية جارية. استخدم <b>إضافة شهيد جديد</b> لبدء الإضافة", reply_markup=get_keyboard(['إضافة شهيد جديد']))
        return
    
    if session['state'] == STATES['WAITING_FIRST_NAME']:
        if not text.strip():
            send_message(chat_id, "❌ الرجاء إدخال الاسم الأول")
            return
        session['data']['first_name'] = text.strip()
        session['state'] = STATES['WAITING_FATHER_NAME']
        save_user_session(user_id, session)
        send_message(chat_id, "2️⃣ الرجاء إدخال اسم الأب:", reply_markup=get_keyboard(['إلغاء']))
        
    elif session['state'] == STATES['WAITING_FATHER_NAME']:
        if not text.strip():
            send_message(chat_id, "❌ الرجاء إدخال اسم الأب")
            return
        session['data']['father_name'] = text.strip()
        session['state'] = STATES['WAITING_FAMILY_NAME']
        save_user_session(user_id, session)
        send_message(chat_id, "3️⃣ الرجاء إدخال اسم العائلة:", reply_markup=get_keyboard(['إلغاء']))
        
    elif session['state'] == STATES['WAITING_FAMILY_NAME']:
        if not text.strip():
            send_message(chat_id, "❌ الرجاء إدخال اسم العائلة")
            return
        session['data']['family_name'] = text.strip()
        session['state'] = STATES['WAITING_AGE']
        save_user_session(user_id, session)
        send_message(chat_id, "4️⃣ الرجاء إدخال عمر الشهيد:", reply_markup=get_keyboard(['إلغاء']))
        
    elif session['state'] == STATES['WAITING_AGE']:
        try:
            age = int(text)
            if age < 0 or age > 150:
                send_message(chat_id, "❌ الرجاء إدخال عمر صحيح (0-150)")
                return
        except ValueError:
            send_message(chat_id, "❌ الرجاء إدخال رقم صحيح للعمر")
            return
        
        session['data']['age'] = age
        session['state'] = STATES['WAITING_BIRTH_DATE']
        save_user_session(user_id, session)
        send_message(chat_id, "5️⃣ الرجاء إدخال تاريخ الولادة (مثال: 1990/01/15):", reply_markup=get_keyboard(['إلغاء']))
        
    elif session['state'] == STATES['WAITING_BIRTH_DATE']:
        if not text.strip():
            send_message(chat_id, "❌ الرجاء إدخال تاريخ الولادة")
            return
        session['data']['birth_date'] = text.strip()
        session['state'] = STATES['WAITING_MARTYRDOM_DATE']
        save_user_session(user_id, session)
        send_message(chat_id, "6️⃣ الرجاء إدخال تاريخ الاستشهاد (مثال: 2024/03/15):", reply_markup=get_keyboard(['إلغاء']))
        
    elif session['state'] == STATES['WAITING_MARTYRDOM_DATE']:
        if not text.strip():
            send_message(chat_id, "❌ الرجاء إدخال تاريخ الاستشهاد")
            return
        session['data']['martyrdom_date'] = text.strip()
        session['state'] = STATES['WAITING_PLACE']
        save_user_session(user_id, session)
        send_message(chat_id, "7️⃣ الرجاء إدخال مكان الاستشهاد:", reply_markup=get_keyboard(['إلغاء']))
        
    elif session['state'] == STATES['WAITING_PLACE']:
        if not text.strip():
            send_message(chat_id, "❌ الرجاء إدخال مكان الاستشهاد")
            return
        session['data']['place'] = text.strip()
        session['state'] = STATES['WAITING_PHOTO']
        save_user_session(user_id, session)
        send_message(chat_id, "8️⃣ الرجاء إرسال صورة الشهيد:\n\nيمكنك إضافة تعليق على الصورة إذا رغبت", reply_markup=get_keyboard(['إلغاء']))

def handle_photo_message(chat_id, user_id, photo_data, caption=""):
    """معالجة الصور"""
    session = get_user_session(user_id)
    
    if session['state'] != STATES['WAITING_PHOTO']:
        send_message(chat_id, "📸 يرجى اتباع الخطوات بالترتيب\n\nاستخدم <b>إضافة شهيد جديد</b> لبدء الإضافة", reply_markup=get_keyboard(['إضافة شهيد جديد']))
        return
    
    # أخذ أكبر حجم صورة
    photo = photo_data[-1]
    photo_file_id = photo['file_id']
    session['data']['photo_file_id'] = photo_file_id
    session['data']['photo_caption'] = caption
    
    # إنهاء الطلب
    complete_request(chat_id, user_id, session)

def complete_request(chat_id, user_id, session):
    """إكمال الطلب وحفظه"""
    # تكوين الاسم الكامل
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
        
        # إنشاء الرسالة الملخص مع الصورة
        message_summary = f"""✅ تم إرسال طلبك بنجاح!

📋 ملخص البيانات:
👤 الاسم: {full_name}
🎂 العمر: {martyr_data.get('age', 'غير متوفر')}
📅 الولادة: {martyr_data.get('birth_date', 'غير متوفر')}
🕊️ الاستشهاد: {martyr_data.get('martyrdom_date', 'غير متوفر')}
📍 المكان: {martyr_data.get('place', 'غير متوفر')}

⏳ سيتم مراجعة طلبك من قبل الإدارة
📱 يمكنك متابعة حالة طلبك باستخدام <b>عرض طلباتي</b>"""
        
        # إرسال الصورة والرسالة في نفس الوقت (إذا أمكن)
        photo_file_id = martyr_data.get('photo_file_id')
        if photo_file_id:
            try:
                send_photo(chat_id, photo_file_id, caption=message_summary, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))
            except Exception as e:
                logger.error(f"Error sending photo with summary: {e}")
                send_message(chat_id, message_summary, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))
        else:
            send_message(chat_id, message_summary, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))

    else:
        send_message(chat_id, "حدث خطأ في حفظ الطلب، يرجى المحاولة مرة أخرى", reply_markup=get_keyboard(['إضافة شهيد جديد']))

def show_help(chat_id):
    """عرض المساعدة"""
    help_text = """🤖 مساعدة بوت معرض شهداء الساحل السوري

📋 الأوامر المتاحة:

🔹 /start - الترحيب والبدء
🔹 إضافة شهيد جديد - بدء عملية الإضافة
🔹 عرض طلباتي - عرض حالة طلباتك
🔹 إلغاء - إلغاء العملية الحالية
🔹 مساعدة - عرض هذه المساعدة

📝 خطوات إضافة شهيد:
1️⃣ الاسم الأول
2️⃣ اسم الأب  
3️⃣ اسم العائلة
4️⃣ العمر
5️⃣ تاريخ الولادة
6️⃣ تاريخ الاستشهاد
7️⃣ مكان الاستشهاد
8️⃣ صورة الشهيد

⏳ جميع الطلبات تخضع لمراجعة الإدارة قبل النشر"""
    
    send_message(chat_id, help_text, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي', 'مساعدة']))

def show_user_requests(chat_id, user_id):
    """عرض طلبات المستخدم"""
    try:
        ref = db.reference(f'user_requests/{user_id}')
        requests_data = ref.get()
        
        if not requests_data:
            send_message(chat_id, "📍 لم تقم بتقديم أي طلبات حتى الآن\n\nلإضافة شهيد جديد استخدم <b>إضافة شهيد جديد</b>", reply_markup=get_keyboard(['إضافة شهيد جديد']))
            return
        
        message = "📋 طلباتك:\n\n"
        count = 0
        
        for request_id, request_data in requests_data.items():
            count += 1
            status_emoji = {
                'pending': '⏳ قيد المراجعة',
                'approved': '✅ مقبول',
                'rejected': '❌ مرفوض'
            }.get(request_data.get('status', 'pending'), '⏳ قيد المراجعة')
            
            full_name = request_data.get('martyr_data', {}).get('full_name', 'غير محدد')
            message += f"{count}. {full_name} - {status_emoji}\n"
        
        send_message(chat_id, message, reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))
        
    except Exception as e:
        logger.error(f"Error showing user requests: {e}")
        send_message(chat_id, "حدث خطأ في استرجاع الطلبات", reply_markup=get_keyboard(['إضافة شهيد جديد', 'عرض طلباتي']))

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
            
            # معلومات المستخدم
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
                
        return jsonify({'status': 'ok'})
        
    except Exception as e:
        logger.error(f"Error processing update: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
