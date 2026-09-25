export interface MtlsWatchPaths {
    caPath?: string;
    certPath?: string;
    keyPath?: string;
}
export declare class MtlsCertWatcher {
    private watchers;
    start(paths: MtlsWatchPaths): void;
    stop(): void;
}
//# sourceMappingURL=mtls-watcher.d.ts.map