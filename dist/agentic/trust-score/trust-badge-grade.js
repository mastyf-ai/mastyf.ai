/** Letter grade + color helpers shared by MastyfAiScore and embeddable badges. */
export const TRUST_GRADE_COLORS = {
    'A+': '#00C853',
    A: '#64DD17',
    B: '#FFD600',
    C: '#FF9100',
    D: '#FF3D00',
    F: '#D50000',
};
export function computeTrustGrade(score) {
    if (score >= 90)
        return 'A+';
    if (score >= 80)
        return 'A';
    if (score >= 70)
        return 'B';
    if (score >= 55)
        return 'C';
    if (score >= 35)
        return 'D';
    return 'F';
}
export function trustGradeColor(grade) {
    return TRUST_GRADE_COLORS[grade] || '#64748b';
}
export function trustGradeTextColor(grade) {
    return grade === 'B' ? '#1a1a1a' : '#ffffff';
}
//# sourceMappingURL=trust-badge-grade.js.map