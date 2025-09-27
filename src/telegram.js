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

export async function sendTelegramMessage(chatId, options = {}, env) {
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
        payload.reply_markup = JSON.stringify(replyMarkup);
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


export async function answerCallbackQuery(callbackQueryId, env, text = '') {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
    await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            callback_query_id: callbackQueryId,
            text: text
        }),
    });
}

export async function uploadPhotoToImgbb(fileId, env) {
    const IMGBB_API_KEY = env.IMGBB_API_KEY;
    try {
        const fileUrl = await getTelegramPhotoUrl(fileId, env);
        if (!fileUrl) {
            console.error('Could not get Telegram file URL.');
            return null;
        }

        const imageResponse = await fetch(fileUrl);
        const imageBlob = await imageResponse.blob();

        const formData = new FormData();
        formData.append('key', IMGBB_API_KEY);
        formData.append('image', imageBlob);

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
