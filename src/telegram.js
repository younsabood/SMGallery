/**
 * Returns the base Telegram API URL for a given bot token.
 * @param {string} token - The Telegram bot token.
 * @returns {string} The base API URL.
 */
const getTelegramApiBaseUrl = (token) => `https://api.telegram.org/bot${token}/`;

/**
 * Fetches the public URL of a file from Telegram using its file_id.
 * @param {string} fileId - The file_id of the photo.
 * @param {object} env - The environment object containing the BOT_TOKEN.
 * @returns {Promise<string|null>} The public URL of the file or null on error.
 */
async function getTelegramPhotoUrl(fileId, env) {
    const apiUrl = getTelegramApiBaseUrl(env.BOT_TOKEN);
    try {
        const response = await fetch(`${apiUrl}getFile?file_id=${fileId}`);
        const data = await response.json();
        if (data.ok && data.result.file_path) {
            return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${data.result.file_path}`;
        }
        console.error('Telegram API getFile failed:', data.description);
        return null;
    } catch (error) {
        console.error('Error getting Telegram file path:', error.message);
        return null;
    }
}

/**
 * Sends a message to a Telegram chat. It can handle both text and photo messages.
 * @param {number} chatId - The target chat ID.
 * @param {object} options - Message options.
 * @param {string} [options.text] - The text of the message.
 * @param {object} [options.replyMarkup] - The keyboard markup.
 * @param {string} [options.photoId] - The file_id of the photo to send.
 * @param {string} [options.photoCaption] - The caption for the photo.
 * @param {object} env - The environment object containing the BOT_TOKEN.
 */
export async function sendTelegramMessage(chatId, options = {}, env) {
    const { text, replyMarkup, photoId, photoCaption } = options;
    const apiUrl = getTelegramApiBaseUrl(env.BOT_TOKEN);
    
    const method = photoId ? "sendPhoto" : "sendMessage";
    const url = `${apiUrl}${method}`;

    const payload = {
        chat_id: chatId,
        parse_mode: 'HTML',
        ...(photoId ? { photo: photoId, caption: photoCaption } : { text: text || "رسالة فارغة" }),
        ...(replyMarkup && { reply_markup: JSON.stringify(replyMarkup) })
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
        }
        console.log(`Message sent successfully to chat ${chatId}`);
    } catch (error) {
        console.error(`Error sending message to chat ${chatId}:`, error.message);
    }
}

/**
 * Answers a callback query from an inline keyboard button press.
 * @param {string} callbackQueryId - The ID of the callback query.
 * @param {object} env - The environment object.
 * @param {string} [text=''] - The text to show in the notification.
 */
export async function answerCallbackQuery(callbackQueryId, env, text = '') {
    const url = `${getTelegramApiBaseUrl(env.BOT_TOKEN)}answerCallbackQuery`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: text }),
    });
}

/**
 * Uploads a photo from Telegram to ImgBB.
 * @param {string} fileId - The file_id of the photo on Telegram.
 * @param {object} env - The environment object with IMGBB_API_KEY.
 * @returns {Promise<string|null>} The URL of the uploaded image on ImgBB or null on failure.
 */
export async function uploadPhotoToImgbb(fileId, env) {
    try {
        const fileUrl = await getTelegramPhotoUrl(fileId, env);
        if (!fileUrl) return null;

        const imageResponse = await fetch(fileUrl);
        const imageBlob = await imageResponse.blob();

        const formData = new FormData();
        formData.append('key', env.IMGBB_API_KEY);
        formData.append('image', imageBlob);

        const response = await fetch('https://api.imgbb.com/1/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();
        if (data.success) {
            console.log('Photo uploaded to imgbb successfully.');
            return data.data.url;
        }
        console.error('imgbb upload failed:', data.error.message);
        return null;
    } catch (error) {
        console.error('Error uploading photo to imgbb:', error.message);
        return null;
    }
}