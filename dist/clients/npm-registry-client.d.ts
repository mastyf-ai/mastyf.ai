/**
 * Lightweight npm registry client for package existence + version resolution.
 */
export type NpmPackageMeta = {
    name: string;
    version: string;
    description?: string;
    homepage?: string;
    repository?: string;
};
export declare class NpmPackageNotFoundError extends Error {
    constructor(packageName: string);
}
/** Valid npm package name (scoped or unscoped). */
export declare function isValidNpmPackageName(name: string): boolean;
export declare function fetchNpmPackage(packageName: string, version?: string): Promise<NpmPackageMeta>;
//# sourceMappingURL=npm-registry-client.d.ts.map