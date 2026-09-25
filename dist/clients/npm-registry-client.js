/**
 * Lightweight npm registry client for package existence + version resolution.
 */
export class NpmPackageNotFoundError extends Error {
    constructor(packageName) {
        super(`Package not found on npm: ${packageName}`);
        this.name = 'NpmPackageNotFoundError';
    }
}
/** Valid npm package name (scoped or unscoped). */
export function isValidNpmPackageName(name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 214)
        return false;
    const scoped = /^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/i;
    const unscoped = /^[a-z0-9-~][a-z0-9-._~]*$/i;
    return scoped.test(trimmed) || unscoped.test(trimmed);
}
function registryUrl(packageName, version) {
    const encoded = encodeURIComponent(packageName);
    if (version && version !== 'latest') {
        return `https://registry.npmjs.org/${encoded}/${encodeURIComponent(version)}`;
    }
    return `https://registry.npmjs.org/${encoded}`;
}
function pickVersion(doc, requested) {
    if (requested && requested !== 'latest')
        return requested;
    const distTags = doc['dist-tags'];
    if (distTags?.latest)
        return distTags.latest;
    const versions = doc.versions;
    if (versions) {
        const keys = Object.keys(versions).sort();
        if (keys.length)
            return keys[keys.length - 1];
    }
    throw new NpmPackageNotFoundError(String(doc.name ?? 'unknown'));
}
function metaFromVersionDoc(packageName, version, doc) {
    const repo = doc.repository;
    const repoUrl = typeof repo === 'string' ? repo : repo?.url;
    return {
        name: String(doc.name ?? packageName),
        version: String(doc.version ?? version),
        description: typeof doc.description === 'string' ? doc.description : undefined,
        homepage: typeof doc.homepage === 'string' ? doc.homepage : undefined,
        repository: repoUrl,
    };
}
export async function fetchNpmPackage(packageName, version) {
    const name = packageName.trim();
    if (!isValidNpmPackageName(name)) {
        throw new Error('invalid_package_name');
    }
    if (version && version !== 'latest') {
        const res = await fetch(registryUrl(name, version));
        if (res.status === 404)
            throw new NpmPackageNotFoundError(name);
        if (!res.ok)
            throw new Error(`npm_registry_error:${res.status}`);
        const doc = (await res.json());
        return metaFromVersionDoc(name, version, doc);
    }
    const res = await fetch(registryUrl(name));
    if (res.status === 404)
        throw new NpmPackageNotFoundError(name);
    if (!res.ok)
        throw new Error(`npm_registry_error:${res.status}`);
    const doc = (await res.json());
    const resolved = pickVersion(doc);
    const versions = doc.versions;
    const versionDoc = versions?.[resolved] ?? doc;
    return metaFromVersionDoc(name, resolved, versionDoc);
}
//# sourceMappingURL=npm-registry-client.js.map