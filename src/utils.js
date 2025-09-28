export function generateRequestId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function calculateAge(birthDate, martyrdomDate) {
    // Expects YYYY/MM/DD format
    const birthParts = birthDate.split('/');
    const martyrdomParts = martyrdomDate.split('/');

    if (birthParts.length !== 3 || martyrdomParts.length !== 3) {
        return null;
    }

    const birthYear = parseInt(birthParts[0], 10);
    const birthMonth = parseInt(birthParts[1], 10) - 1; // Month is 0-indexed
    const birthDay = parseInt(birthParts[2], 10);

    const martyrdomYear = parseInt(martyrdomParts[0], 10);
    const martyrdomMonth = parseInt(martyrdomParts[1], 10) - 1; // Month is 0-indexed
    const martyrdomDay = parseInt(martyrdomParts[2], 10);

    const birth = new Date(Date.UTC(birthYear, birthMonth, birthDay));
    const martyrdom = new Date(Date.UTC(martyrdomYear, martyrdomMonth, martyrdomDay));

    // Check if the constructed dates are valid and the parsed components were not NaN
    if (isNaN(birth.getTime()) || isNaN(martyrdom.getTime())) {
        return null;
    }

    let age = martyrdom.getUTCFullYear() - birth.getUTCFullYear();
    const m = martyrdom.getUTCMonth() - birth.getUTCMonth();
    if (m < 0 || (m === 0 && martyrdom.getUTCDate() < birth.getUTCDate())) {
        age--;
    }
    return age;
}
