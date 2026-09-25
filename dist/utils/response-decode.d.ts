export interface ResponseDecodeResult {
    text: string;
    decoded: boolean;
    passes: string[];
}
/**
 * Prepare response body for DLP scanning — decodes common encoding evasions.
 */
export declare function decodeResponseForInspection(raw: string, opts?: {
    unicodeStrict?: boolean;
}): ResponseDecodeResult;
//# sourceMappingURL=response-decode.d.ts.map