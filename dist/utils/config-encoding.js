/**
 * Decode MCP config file bytes as UTF-8 (handles BOM and accidental UTF-16 LE exports).
 */
export function decodeConfigFile(buffer) {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.toString('utf16le');
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return buffer.swap16().toString('utf16le');
    }
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff)
        text = text.slice(1);
    return text;
}
//# sourceMappingURL=config-encoding.js.map