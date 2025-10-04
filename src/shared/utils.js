export function generateRequestId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function parseDate(dateString) {
    // التحقق من أن النص المدخل هو نص صالح
    if (typeof dateString !== 'string') {
        return null;
    }

    const parts = dateString.split('/');
    if (parts.length !== 3) {
        return null; // تنسيق غير صالح إذا لم يكن هناك 3 أجزاء
    }

    let year, month, day;

    // التحقق من تنسيق YYYY/MM/DD (مثال: 1999/09/29)
    if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
    } 
    // التحقق من تنسيق DD/MM/YYYY (مثال: 29/09/1999)
    else if (parts[2].length === 4) {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
    } 
    // إذا لم يتطابق أي من التنسيقين، يتم إرجاع null
    else {
        return null;
    }

    // التحقق من أن الأجزاء تم تحليلها كأرقام بنجاح وأن القيم ضمن النطاق الصحيح
    if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }
    
    // في كائن Date في JavaScript، يبدأ عد الأشهر من 0 (يناير = 0)
    const date = new Date(Date.UTC(year, month - 1, day));

    // التحقق النهائي للتأكد من أن التاريخ حقيقي (مثلاً، ليس 2023/02/30)
    // وأن التاريخ الذي تم إنشاؤه يطابق المكونات التي تم تحليلها
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }

    return date;
}


/**
 * تحسب العمر بين تاريخ الميلاد وتاريخ الاستشهاد.
 * تدعم تنسيقات التواريخ: YYYY/MM/DD, YYYY/M/D, DD/MM/YYYY, D/M/YYYY
 * @param {string} birthDateString - تاريخ الميلاد كنص.
 * @param {string} martyrdomDateString - تاريخ الاستشهاد كنص.
 * @returns {number|null} العمر المحسوب، أو null إذا كانت التواريخ غير صالحة.
 */
export function calculateAge(birthDateString, martyrdomDateString) {
    const birthDate = parseDate(birthDateString);
    const martyrdomDate = parseDate(martyrdomDateString);

    // إذا كان أي من التاريخين غير صالح، يتم إرجاع null
    if (!birthDate || !martyrdomDate) {
        return null;
    }

    // التحقق من أن تاريخ الاستشهاد ليس قبل تاريخ الميلاد
    if (martyrdomDate < birthDate) {
        return null;
    }

    let age = martyrdomDate.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDifference = martyrdomDate.getUTCMonth() - birthDate.getUTCMonth();
    
    // إذا لم يأتِ شهر الميلاد بعد، أو أتى ولكن لم يأتِ يوم الميلاد بعد، ننقص سنة من العمر
    if (monthDifference < 0 || (monthDifference === 0 && martyrdomDate.getUTCDate() < birthDate.getUTCDate())) {
        age--;
    }
    
    // تأكد من أن العمر ليس سالبًا
    return age < 0 ? 0 : age;
}