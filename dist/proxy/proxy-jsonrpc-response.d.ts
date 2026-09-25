import { StdioLineWriter } from './proxy-stdio-writer.js';
export declare class JsonRpcResponseTracker {
    private readonly responded;
    private readonly maxTracked;
    constructor(maxTracked?: number);
    private key;
    hasResponded(id: string | number): boolean;
    markResponded(id: string | number): void;
    clearResponded(id: string | number): void;
    clearAll(): void;
    sendError(writer: StdioLineWriter, id: string | number, code: number, message: string, data?: Record<string, unknown>): boolean;
    sendJson(writer: StdioLineWriter, payload: Record<string, unknown>): boolean;
    writePassthrough(writer: StdioLineWriter, line: string): void;
}
//# sourceMappingURL=proxy-jsonrpc-response.d.ts.map