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
        // Find the row with 'مساعدة' and add 'إلغاء' to it
        const helpRow = layout.find(row => row.includes('مساعدة'));
        if (helpRow) {
            helpRow.push('إلغاء');
        }
    }

    return layout;
}

export function getKeyboard(layout) {
    if (!Array.isArray(layout) || !Array.isArray(layout[0])) {
        // For backward compatibility, if a flat array is passed, create a single column layout
        layout = layout.map(btn => [btn]);
    }
    return {
        keyboard: layout.map(row => row.map(buttonText => ({ text: buttonText }))),
        resize_keyboard: true,
        one_time_keyboard: false
    };
}
