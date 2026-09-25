/**
 * Serialized newline-delimited writes to process.stdout (stdio MCP transport).
 */
export class StdioLineWriter {
    tail = Promise.resolve();
    writeFn;
    constructor(writeFn = (line) => process.stdout.write(line)) {
        this.writeFn = writeFn;
    }
    writeLine(payload) {
        const line = payload.endsWith('\n') ? payload : `${payload}\n`;
        this.tail = this.tail.then(() => {
            this.writeFn(line);
        }, () => {
            this.writeFn(line);
        });
    }
    /** Flush queued writes (for tests). */
    async drain() {
        await this.tail;
    }
}
//# sourceMappingURL=proxy-stdio-writer.js.map