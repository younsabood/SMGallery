export const STATES = {
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

export function getKeyboard(buttons) {
    return {
        keyboard: buttons.map(btn => [{ text: btn }]),
        resize_keyboard: true,
        one_time_keyboard: false
    };
}
