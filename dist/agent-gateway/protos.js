/**
 * Single place where the Envoy `ext_proc` interface is loaded.
 *
 * The protos are read at runtime by `@grpc/proto-loader`, so there is no `protoc`
 * step and no generated code that could drift away from the vendored contract.
 * See `proto/ext-proc/README.md` for provenance and the pinned upstream commits.
 */
import { loadSync } from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** `dist/agent-gateway/` and `src/agent-gateway/` are both one level below the repo root. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROTO_ROOT = path.join(REPO_ROOT, 'proto', 'ext-proc');
const PROTO_FILE = 'envoy/service/ext_proc/v3/external_processor.proto';
/**
 * `keepCase: false`   -- fields arrive camelCased, matching the rest of this codebase.
 * `enums: String`     -- readable names ('Forbidden') rather than magic numbers.
 * `longs: String`     -- no 64-bit precision loss on flow-control window sizes.
 * `oneofs: true`      -- the `request`/`response` oneofs are what this service dispatches on.
 * `defaults: true`    -- unset fields read as falsy values rather than undefined.
 */
export const LOADER_OPTIONS = {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_ROOT],
};
const definition = loadSync(PROTO_FILE, LOADER_OPTIONS);
const loaded = grpc.loadPackageDefinition(definition);
/** gRPC service definition for `envoy.service.ext_proc.v3.ExternalProcessor`. */
export const ExternalProcessorService = loaded.envoy.service.ext_proc.v3
    .ExternalProcessor;
//# sourceMappingURL=protos.js.map