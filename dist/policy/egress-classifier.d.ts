export type EgressClass = 'safe-read' | 'messaging' | 'egress';
export interface EgressClassifyOptions {
    /** A sensitive read already happened in this session: judge GETs more harshly. */
    strict?: boolean;
}
export declare function classifyEgress(toolName: string, args: Record<string, unknown> | undefined, options?: EgressClassifyOptions): EgressClass;
//# sourceMappingURL=egress-classifier.d.ts.map