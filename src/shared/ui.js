import { sendTelegramMessage } from './telegram.js';

export const STATES = {
    IDLE: 'idle',
    WAITING_FIRST_NAME: 'waiting_first_name',
    WAITING_FATHER_NAME: 'waiting_father_name',
    WAITING_FAMILY_NAME: 'waiting_family_name',
    WAITING_BIRTH_DATE: 'waiting_birth_date',
    WAITING_MARTYRDOM_DATE: 'waiting_martyrdom_date',
    WAITING_PLACE: 'waiting_place',
    WAITING_PHOTO: 'waiting_photo'
};

export const REQUEST_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected'
};

export const REQUEST_TYPE = {
    ADD: 'add',
    EDIT: 'edit',
    DELETE: 'delete'
};

export function createMainKeyboard(state) {
    const layout = [
        ['إضافة شهيد جديد'],
        ['عرض طلباتي', 'عرض اضافاتي'],
        ['مساعدة']
    ];

    if (state && state !== STATES.IDLE) {
        const helpRow = layout.find(row => row.includes('مساعدة'));
        if (helpRow) {
            helpRow.push('إلغاء');
        }
    }

    return layout;
}

export function getKeyboard(layout) {
    if (!Array.isArray(layout) || !Array.isArray(layout[0])) {
        layout = layout.map(btn => [btn]);
    }
    return {
        keyboard: layout.map(row => row.map(buttonText => ({ text: buttonText }))),
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

/**
 * Sends a message for a single item, either as a photo with caption or as plain text.
 * @param {number} chatId - The chat ID to send the message to.
 * @param {object} item - The data item (e.g., martyr or request).
 * @param {string} caption - The formatted text caption for the item.
 * @param {object} inlineKeyboard - The inline keyboard markup.
 * @param {object} env - The environment object.
 */
async function sendItemMessage(chatId, item, caption, inlineKeyboard, env) {
    const message = {
        replyMarkup: inlineKeyboard
    };
    if (item.image_url) {
        message.photoId = item.image_url;
        message.photoCaption = caption;
    } else {
        message.text = caption;
    }
    await sendTelegramMessage(chatId, message, env);
}

/**
 * Displays a list of items (e.g., martyrs, requests) to the user in a structured format.
 * @param {number} chatId - The user's chat ID.
 * @param {object} env - The environment object.
 * @param {Array<object>} items - The array of items to display.
 * @param {string} title - The title to display before the list.
 * @param {function} formatter - A function that takes an item and returns an object with { caption, inlineKeyboard }.
 * @param {string} noItemsMessage - The message to send if the items array is empty.
 */
export async function displayItems(chatId, env, items, title, formatter, noItemsMessage) {
    if (items && items.length > 0) {
        await sendTelegramMessage(chatId, { text: title }, env);
        for (const item of items) {
            const { caption, inlineKeyboard } = formatter(item);
            await sendItemMessage(chatId, item, caption, inlineKeyboard, env);
        }
    } else {
        await sendTelegramMessage(chatId, {
            text: noItemsMessage,
            replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
        }, env);
    }
}