export function walkStringLeaves(obj, prefix = '') {
    if (typeof obj === 'string') {
        return [{ path: prefix || '$', value: obj }];
    }
    if (obj === null || obj === undefined)
        return [];
    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return [{ path: prefix || '$', value: String(obj) }];
    }
    if (Array.isArray(obj)) {
        return obj.flatMap((item, i) => walkStringLeaves(item, prefix ? `${prefix}[${i}]` : `[${i}]`));
    }
    if (typeof obj === 'object') {
        return Object.entries(obj).flatMap(([key, val]) => walkStringLeaves(val, prefix ? `${prefix}.${key}` : key));
    }
    return [{ path: prefix || '$', value: String(obj) }];
}
/** Collect decoded string values from all argument leaves. */
export function collectStringLeafValues(obj) {
    return walkStringLeaves(obj).map((l) => l.value);
}
//# sourceMappingURL=arg-leaf-walker.js.map