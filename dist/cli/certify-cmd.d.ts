export type CertifyPublishCliOpts = {
    server: string;
    package: string;
    version: string;
    cloudUrl?: string;
    apiKey?: string;
    config?: string;
    db?: string;
    json?: boolean;
};
export declare function runCertifyPublishCli(opts: CertifyPublishCliOpts): Promise<number>;
//# sourceMappingURL=certify-cmd.d.ts.map