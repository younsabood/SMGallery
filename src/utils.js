export function generateRequestId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function calculateAge(birthDate, martyrdomDate) {
    const birth = new Date(birthDate);
    const martyrdom = new Date(martyrdomDate);
    if (isNaN(birth) || isNaN(martyrdom)) {
        return null;
    }
    let age = martyrdom.getFullYear() - birth.getFullYear();
    const m = martyrdom.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && martyrdom.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}
