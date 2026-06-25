/** Lightweight recursive decode for argument scanning (base64, hex, URL). */

export function tryDecodeVariants(value: string): string[] {
  const decoded: string[] = [value];
  if (/^[A-Za-z0-9+/]{12,}={0,2}$/.test(value.trim())) {
    try {
      const d = Buffer.from(value.trim(), "base64").toString("utf-8");
      if (d.length >= 4) decoded.push(d);
    } catch {
      /* ignore */
    }
  }
  if (/^[0-9a-fA-F]{12,}$/.test(value.trim()) && value.trim().length % 2 === 0) {
    try {
      const d = Buffer.from(value.trim(), "hex").toString("utf-8");
      if (/[\x20-\x7E]/.test(d)) decoded.push(d);
    } catch {
      /* ignore */
    }
  }
  if (/%[0-9a-fA-F]{2}/.test(value)) {
    try {
      decoded.push(decodeURIComponent(value));
    } catch {
      /* ignore */
    }
  }
  for (const d of decoded.slice(1)) {
    if (/^[A-Za-z0-9+/]{12,}={0,2}$/.test(d.trim())) {
      try {
        const dd = Buffer.from(d.trim(), "base64").toString("utf-8");
        if (dd.length >= 4) decoded.push(dd);
      } catch {
        /* ignore */
      }
    }
  }
  return [...new Set(decoded)];
}
