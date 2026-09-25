import { scanForSecrets } from '../../scanners/secret-scanner.js';
/** Block HIGH-severity secrets in tool arguments (parity with proxy DLP path). */
export const secretsInArgsStrategy = {
    name: 'secrets-in-args',
    evaluate({ raw, normalized, argsStr }, deps) {
        const scanContext = `policy:${normalized.serverName}:${normalized.toolName}`;
        const blobs = [
            JSON.stringify(raw.arguments ?? {}),
            argsStr.length > 0 ? argsStr : JSON.stringify(normalized.arguments ?? {}),
        ].filter((b) => b.length >= 8);
        const findings = blobs.flatMap((blob) => scanForSecrets(blob, scanContext));
        const blocking = findings.filter((f) => f.severity === 'HIGH');
        if (blocking.length === 0)
            return null;
        const uniqueTypes = [...new Set(blocking.map((f) => f.type))];
        return {
            action: deps.resolveAction('block'),
            rule: 'secret-scan',
            reason: `${uniqueTypes.length} secret(s) in tool arguments: ${uniqueTypes.slice(0, 5).join(', ')}`,
        };
    },
};
//# sourceMappingURL=secrets-in-args-strategy.js.map