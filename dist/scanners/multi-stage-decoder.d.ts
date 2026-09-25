/**
 * Multi-Stage Recursive Encoding Decoder
 *
 * Iteratively unmasks layered obfuscations (Base64 -> Hex -> URL -> Unicode -> HTML entities)
 * to prevent encoding evasion from hiding malicious instructions.
 */
export interface DecodeStage {
    type: 'base64' | 'hex-escape' | 'url-encode' | 'unicode-escape' | 'html-entity' | 'none';
    originalSnippet?: string;
    decodedSnippet?: string;
}
export interface MultiStageDecodeResult {
    original: string;
    final: string;
    stages: DecodeStage[];
    passCount: number;
    changed: boolean;
}
/**
 * Runs multi-stage recursive decoding up to maxPasses.
 */
export declare function multiStageDecode(input: string, maxPasses?: number): MultiStageDecodeResult;
//# sourceMappingURL=multi-stage-decoder.d.ts.map