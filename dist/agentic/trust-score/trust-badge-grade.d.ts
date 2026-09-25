/** Letter grade + color helpers shared by MastyfAiScore and embeddable badges. */
export type TrustGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export declare const TRUST_GRADE_COLORS: Record<TrustGrade, string>;
export declare function computeTrustGrade(score: number): TrustGrade;
export declare function trustGradeColor(grade: TrustGrade | string): string;
export declare function trustGradeTextColor(grade: TrustGrade | string): string;
//# sourceMappingURL=trust-badge-grade.d.ts.map