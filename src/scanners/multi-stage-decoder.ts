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
 * Attempts a single decode pass on the input string across 5 common encoding schemes.
 */
function attemptDecodePass(input: string): { changed: boolean; output: string; stage: DecodeStage } {
  // 1. URL percent-encoding (%2F%2E%2E, %20, %3C)
  if (/%[0-9a-fA-F]{2}/.test(input)) {
    try {
      const decoded = decodeURIComponent(input);
      if (decoded !== input) {
        return {
          changed: true,
          output: decoded,
          stage: { type: 'url-encode' },
        };
      }
    } catch {
      // Malformed URL component, continue to other decoders
    }
  }

  // 2. Hex escape sequences (\x41\x42, \\x41)
  if (/\\x[0-9a-fA-F]{2}/.test(input)) {
    const decoded = input.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    if (decoded !== input) {
      return {
        changed: true,
        output: decoded,
        stage: { type: 'hex-escape' },
      };
    }
  }

  // 3. Unicode escape sequences (\u0041, \\u0041)
  if (/\\u[0-9a-fA-F]{4}/.test(input)) {
    const decoded = input.replace(/\\u([0-9a-fA-F]{4})/g, (_, uHex) =>
      String.fromCharCode(parseInt(uHex, 16)),
    );
    if (decoded !== input) {
      return {
        changed: true,
        output: decoded,
        stage: { type: 'unicode-escape' },
      };
    }
  }

  // 4. HTML numeric entities (&#x41; or &#65;)
  if (/&#x?[0-9a-fA-F]+;/.test(input)) {
    const decoded = input
      .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
    if (decoded !== input) {
      return {
        changed: true,
        output: decoded,
        stage: { type: 'html-entity' },
      };
    }
  }

  // 5. Base64 strings (valid base64 tokens of length >= 8)
  const b64Regex = /(?:^|[\s:="',`([{<])([A-Za-z0-9+/]{4,}={0,2})(?=$|[\s:="',`)}\]>])/g;
  let b64Changed = false;
  const replaced = input.replace(b64Regex, (fullMatch, token) => {
    if (!token || token.length < 8) return fullMatch;
    // Only attempt if length is multiple of 4
    if (token.length % 4 !== 0) return fullMatch;
    try {
      const buff = Buffer.from(token, 'base64');
      const text = buff.toString('utf8');
      // Only replace if decoded string consists predominantly of printable ASCII characters
      if (/^[\x20-\x7E\r\n\t]+$/.test(text) && text.trim().length > 3) {
        b64Changed = true;
        return fullMatch.replace(token, text);
      }
    } catch {}
    return fullMatch;
  });

  if (b64Changed && replaced !== input) {
    return {
      changed: true,
      output: replaced,
      stage: { type: 'base64' },
    };
  }

  return {
    changed: false,
    output: input,
    stage: { type: 'none' },
  };
}

/**
 * Runs multi-stage recursive decoding up to maxPasses.
 */
export function multiStageDecode(input: string, maxPasses = 5): MultiStageDecodeResult {
  const stages: DecodeStage[] = [];
  let current = input;

  for (let pass = 0; pass < maxPasses; pass++) {
    const passResult = attemptDecodePass(current);
    if (!passResult.changed) {
      break;
    }
    stages.push(passResult.stage);
    current = passResult.output;
  }

  return {
    original: input,
    final: current,
    stages,
    passCount: stages.length,
    changed: stages.length > 0,
  };
}
