export class JsonRpcResponseTracker {
    responded = new Set();
    maxTracked;
    constructor(maxTracked = 10_000) {
        this.maxTracked = maxTracked;
    }
    key(id) {
        return String(id);
    }
    hasResponded(id) {
        return this.responded.has(this.key(id));
    }
    markResponded(id) {
        const k = this.key(id);
        if (this.responded.size >= this.maxTracked) {
            const first = this.responded.values().next().value;
            if (first !== undefined)
                this.responded.delete(first);
        }
        this.responded.add(k);
    }
    clearResponded(id) {
        this.responded.delete(this.key(id));
    }
    clearAll() {
        this.responded.clear();
    }
    sendError(writer, id, code, message, data) {
        if (this.hasResponded(id))
            return false;
        this.markResponded(id);
        writer.writeLine(JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code, message, data },
        }));
        return true;
    }
    sendJson(writer, payload) {
        const id = payload.id;
        if (id != null && (typeof id === 'string' || typeof id === 'number')) {
            if (this.hasResponded(id))
                return false;
            this.markResponded(id);
        }
        writer.writeLine(JSON.stringify(payload));
        return true;
    }
    writePassthrough(writer, line) {
        writer.writeLine(line);
    }
}
//# sourceMappingURL=proxy-jsonrpc-response.js.map