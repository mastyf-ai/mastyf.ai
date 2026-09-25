/** Word-wrap plain text for terminal display; preserves paragraph breaks. */
export function wrapPlainText(text, width) {
    const out = [];
    const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
    for (const para of paragraphs) {
        if (!para.trim()) {
            out.push('');
            continue;
        }
        const words = para.split(/\s+/);
        let line = '';
        for (const w of words) {
            const next = line ? `${line} ${w}` : w;
            if (next.length > width && line) {
                out.push(line);
                line = w;
            }
            else {
                line = next;
            }
        }
        if (line)
            out.push(line);
    }
    return out;
}
//# sourceMappingURL=text-wrap.js.map