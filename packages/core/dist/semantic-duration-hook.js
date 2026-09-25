let durationHook = null;
export function setSemanticScanDurationHook(hook) {
    durationHook = hook;
}
export function reportSemanticScanDuration(phase, durationMs, outcome) {
    durationHook?.(phase, durationMs, outcome);
}
//# sourceMappingURL=semantic-duration-hook.js.map