# -*- coding: utf-8 -*-
import os
import json
import logging
from datetime import datetime
from flask import Flask, request, jsonify
import requests
import firebase_admin
from firebase_admin import credentials, firestore

# إعداد التسجيل
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# إعداد Flask
app = Flask(__name__)

# إعدادات البوت
BOT_TOKEN = "8272634262:AAHXUYw_Q-0fwuyFAc5j6ntgtZHt3VyWCOM"
ADMIN_USER_ID = "5679396406"  # ID المستخدم الخاص بك كمدير
TELEGRAM_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}/"

# تهيئة Firebase لقاعدتي البيانات (الإدارة والموقع)
firebase_initialized = False
admin_db = None
view_db = None

try:
    # الحصول على متغيرات البيئة لمشروع الإدارة
    admin_cred_dict = {
        "type": os.environ.get("SYRIANCOASTMARTYRSADMIN_TYPE"),
        "project_id": os.environ.get("SYRIANCOASTMARTYRSADMIN_PROJECT_ID"),
        "private_key_id": os.environ.get("SYRIANCOASTMARTYRSADMIN_PRIVATE_KEY_ID"),
        "private_key": os.environ.get("SYRIANCOASTMARTYRSADMIN_PRIVATE_KEY", "").replace('\\n', '\n'),
        "client_email": os.environ.get("SYRIANCOASTMARTYRSADMIN_CLIENT_EMAIL"),
        "client_id": os.environ.get("SYRIANCOASTMARTYRSADMIN_CLIENT_ID"),
        "auth_uri": os.environ.get("SYRIANCOASTMARTYRSADMIN_AUTH_URI"),
        "token_uri": os.environ.get("SYRIANCOASTMARTYRSADMIN_TOKEN_URI"),
        "auth_provider_x509_cert_url": os.environ.get("SYRIANCOASTMARTYRSADMIN_AUTH_PROVIDER_X509_CERT_URL"),
        "client_x509_cert_url": os.environ.get("SYRIANCOASTMARTYRSADMIN_CLIENT_X509_CERT_URL"),
        "universe_domain": os.environ.get("SYRIANCOASTMARTYRSADMIN_UNIVERSE_DOMAIN")
    }

    # الحصول على متغيرات البيئة لمشروع الموقع
    view_cred_dict = {
        "type": os.environ.get("SYRIANCOASTMARTYRS_TYPE"),
        "project_id": os.environ.get("SYRIANCOASTMARTYRS_PROJECT_ID"),
        "private_key_id": os.environ.get("SYRIANCOASTMARTYRS_PRIVATE_KEY_ID"),
        "private_key": os.environ.get("SYRIANCOASTMARTYRS_PRIVATE_KEY", "").replace('\\n', '\n'),
        "client_email": os.environ.get("SYRIANCOASTMARTYRS_CLIENT_EMAIL"),
        "client_id": os.environ.get("SYRIANCOASTMARTYRS_CLIENT_ID"),
        "auth_uri": os.environ.get("SYRIANCOASTMARTYRS_AUTH_URI"),
        "token_uri": os.environ.get("SYRIANCOASTMARTYRS_TOKEN_URI"),
        "auth_provider_x509_cert_url": os.environ.get("SYRIANCOASTMARTYRS_AUTH_PROVIDER_X509_CERT_URL"),
        "client_x509_cert_url": os.environ.get("SYRIANCOASTMARTYRS_CLIENT_X509_CERT_URL"),
        "universe_domain": os.environ.get("SYRIANCOASTMARTYRS_UNIVERSE_DOMAIN")
    }

    # التحقق من وجود البيانات قبل التهيئة
    if admin_cred_dict.get('private_key_id') and view_cred_dict.get('private_key_id'):
        # التحقق من صحة البيانات
        logger.info(f"Initializing Firebase with Project ID: {admin_cred_dict.get('project_id')}")
        admin_cred = credentials.Certificate(admin_cred_dict)
        admin_app = firebase_admin.initialize_app(admin_cred, name='admin_app')
        admin_db = firestore.client(admin_app)
        logger.info("Admin Firebase app initialized successfully.")

        view_cred = credentials.Certificate(view_cred_dict)
        view_app = firebase_admin.initialize_app(view_cred, name='view_app')
        view_db = firestore.client(view_app)
        logger.info("View Firebase app initialized successfully.")
        
        firebase_initialized = True
    else:
        logger.error("Firebase credentials not found in environment variables. Application will not function correctly.")

except Exception as e:
    logger.error(f"Firebase initialization failed: {e}")
    firebase_initialized = False

# Define the missing function 'is_firebase_ready'
def is_firebase_ready():
    """التحقق من حالة تهيئة Firebase"""
    return firebase_initialized and admin_db is not None and view_db is not None

# Define the missing functions
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

def get_inline_keyboard(buttons):
    """تكوين لوحة مفاتيح inline"""
    keyboard = [[{'text': btn['text'], 'callback_data': btn['callback_data']}] for btn in buttons]
    return {'inline_keyboard': keyboard}

def handle_text_message(chat_id, user_id, text, user_info):
    """معالجة الرسائل النصية"""
    if text == '/start':
        send_telegram_message(chat_id, "Welcome to the bot!")

def handle_photo_message(chat_id, user_id, photo_data, caption=""):
    """معالجة الصور"""
    send_telegram_message(chat_id, "Photo received!")

def handle_callback_query(chat_id, callback_data):
    """معالجة استدعاءات لوحة المفاتيح inline"""
    send_telegram_message(chat_id, f"Callback query received: {callback_data}")

# --- Flask Routes ---
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
