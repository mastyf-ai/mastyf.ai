/**
 * Serialized newline-delimited writes to process.stdout (stdio MCP transport).
 */
export declare class StdioLineWriter {
    private tail;
    private readonly writeFn;
    constructor(writeFn?: (line: string) => boolean);
    writeLine(payload: string): void;
    /** Flush queued writes (for tests). */
    drain(): Promise<void>;
}
//# sourceMappingURL=proxy-stdio-writer.d.ts.map