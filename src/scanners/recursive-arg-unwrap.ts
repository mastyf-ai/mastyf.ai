/**
 * Recursive Argument Unwrapper
 *
 * Flattens arbitrarily nested JSON argument objects/arrays (up to MAX_DEPTH)
 * and extracts nested serialized strings, preventing mcp_hidden_fields evasion.
 */

export interface UnwrapResult {
  flattenedArgs: Record<string, unknown>;
  leafValues: string[];
  depth: number;
  hiddenFieldsDetected: string[];
}

const MAX_DEPTH = 10;
const SUSPICIOUS_NESTED_KEYS = new Set([
  'arguments',
  'params',
  'options',
  'config',
  'settings',
  'override',
  'admin',
  'role',
  'permission',
  'privilege',
  'payload',
  'data',
  'body',
]);

/**
 * Recursively inspects and unwraps arguments.
 */
export function recursiveUnwrap(
  args: Record<string, unknown> | null | undefined,
  depth = 0,
  path = '',
): UnwrapResult {
  const result: UnwrapResult = {
    flattenedArgs: {},
    leafValues: [],
    depth,
    hiddenFieldsDetected: [],
  };

  if (!args || typeof args !== 'object') {
    return result;
  }

  if (depth > MAX_DEPTH) {
    return result;
  }

  for (const [key, value] of Object.entries(args)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();

    if (SUSPICIOUS_NESTED_KEYS.has(lowerKey) && typeof value === 'object' && value !== null) {
      result.hiddenFieldsDetected.push(currentPath);
    }

    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'string') {
      result.flattenedArgs[currentPath] = value;
      result.leafValues.push(value);

      // Attempt to parse string values as JSON (in case payload was string-serialized)
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'object' && parsed !== null) {
            const inner = Array.isArray(parsed)
              ? unwrapArray(parsed, depth + 1, currentPath)
              : recursiveUnwrap(parsed as Record<string, unknown>, depth + 1, currentPath);

            Object.assign(result.flattenedArgs, inner.flattenedArgs);
            result.leafValues.push(...inner.leafValues);
            result.hiddenFieldsDetected.push(...inner.hiddenFieldsDetected);
            result.depth = Math.max(result.depth, inner.depth);
          }
        } catch {
          // Not valid JSON string, leave as string value
        }
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result.flattenedArgs[currentPath] = value;
      result.leafValues.push(String(value));
    } else if (Array.isArray(value)) {
      const inner = unwrapArray(value, depth + 1, currentPath);
      Object.assign(result.flattenedArgs, inner.flattenedArgs);
      result.leafValues.push(...inner.leafValues);
      result.hiddenFieldsDetected.push(...inner.hiddenFieldsDetected);
      result.depth = Math.max(result.depth, inner.depth);
    } else if (typeof value === 'object') {
      const inner = recursiveUnwrap(value as Record<string, unknown>, depth + 1, currentPath);
      Object.assign(result.flattenedArgs, inner.flattenedArgs);
      result.leafValues.push(...inner.leafValues);
      result.hiddenFieldsDetected.push(...inner.hiddenFieldsDetected);
      result.depth = Math.max(result.depth, inner.depth);
    }
  }

  return result;
}

function unwrapArray(arr: unknown[], depth: number, path: string): UnwrapResult {
  const result: UnwrapResult = {
    flattenedArgs: {},
    leafValues: [],
    depth,
    hiddenFieldsDetected: [],
  };

  if (depth > MAX_DEPTH) {
    return result;
  }

  arr.forEach((item, index) => {
    const currentPath = `${path}[${index}]`;
    if (typeof item === 'string') {
      result.flattenedArgs[currentPath] = item;
      result.leafValues.push(item);
    } else if (typeof item === 'number' || typeof item === 'boolean') {
      result.flattenedArgs[currentPath] = item;
      result.leafValues.push(String(item));
    } else if (Array.isArray(item)) {
      const inner = unwrapArray(item, depth + 1, currentPath);
      Object.assign(result.flattenedArgs, inner.flattenedArgs);
      result.leafValues.push(...inner.leafValues);
      result.hiddenFieldsDetected.push(...inner.hiddenFieldsDetected);
      result.depth = Math.max(result.depth, inner.depth);
    } else if (typeof item === 'object' && item !== null) {
      const inner = recursiveUnwrap(item as Record<string, unknown>, depth + 1, currentPath);
      Object.assign(result.flattenedArgs, inner.flattenedArgs);
      result.leafValues.push(...inner.leafValues);
      result.hiddenFieldsDetected.push(...inner.hiddenFieldsDetected);
      result.depth = Math.max(result.depth, inner.depth);
    }
  });

  return result;
}
