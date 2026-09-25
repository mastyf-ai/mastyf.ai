/**
 * Language-specific type confusion / deserialization gadget detection.
 */
import { walkStringLeaves } from './arg-leaf-walker.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
export const LANGUAGE_GADGET_PATTERNS = [
    /\b(?:pickle\.loads?|cPickle\.loads?|dill\.loads?)\b/i,
    /\b__reduce__\b|\bPYCC\b/i,
    /\bObjectInputStream\b|\breadObject\s*\(\s*\)/i,
    /\bjava\.io\.(?:Serializable|ObjectInputStream)\b/i,
    /\b(?:org\.apache\.commons\.collections|ysoserial)/i,
    /\b(?:node-serialize|node-serializer)\b/i,
    /\bunserialize\s*\(\s*['"]/i,
    /\b__wakeup\b|\b__destruct\b.*\beval\b/i,
    /\bMarshal\.load\b|\byaml\.unsafe_load\b|\byaml\.load\s*\([^)]*Loader\s*=\s*yaml\.UnsafeLoader/i,
    /!!python\/object/i,
    /\bcos(?:\\n|\s*\n)\s*system(?:\\n|\s*\n)/i,
    /\bcos\s+system\s*\(/i,
    /<!ENTITY\b|<!DOCTYPE[^>]{0,200}\bENTITY\b/i,
    /\bSYSTEM\s+["']file:\/\//i,
    /\bphp:\/\/filter\b/i,
    /\bRuntime\.getRuntime\s*\(\s*\)\.exec\b/i,
    /\bProcessBuilder\s*\(/i,
    /\bScriptEngineManager\b.*\bgetEngineByName\b/i,
    /\bBinaryFormatter\b.*\bDeserialize\b/i,
    /\bViewState\b.*\bMAC\b/i,
    /\br00t\.me\b/i,
    /application\/x-(?:java-serialized-object|python-serialized)/i,
];
export function evaluateLanguageGadgetGuard(ctx) {
    const blob = walkStringLeaves(ctx.arguments ?? {})
        .map((l) => deobfuscateRecursive(l.value))
        .join('\n');
    if (!blob.trim())
        return null;
    for (const pattern of LANGUAGE_GADGET_PATTERNS) {
        if (pattern.test(blob)) {
            return {
                action: 'block',
                rule: 'semantic-language-gadget',
                reason: 'Language-specific deserialization or gadget chain pattern in arguments',
            };
        }
    }
    return null;
}
//# sourceMappingURL=language-gadget-guard.js.map