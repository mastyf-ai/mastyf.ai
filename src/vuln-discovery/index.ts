/**
 * Vuln Discovery Engine — public exports
 */
export type * from './types.js';
export {
  getVulnStoreDir,
  ensureVulnStoreDir,
  vulnFindingsPath,
  vulnLiveStatsPath,
  vulnPrecisionPath,
  vulnReportsDir,
  vulnDisclosureDir,
} from './paths.js';
export {
  isVulnDiscoveryEnabled,
  isTargetAuthorized,
  auditProbe,
  checkProbeRateLimit,
  getAllowlist,
} from './auth.js';
export {
  loadFindings,
  getFinding,
  upsertFinding,
  updateFindingStatus,
  listFindings,
  fingerprintFinding,
  createFindingId,
  compactFindingsStore,
} from './store.js';
export {
  buildSbomForServer,
  saveSbom,
  loadSbom,
  diffSbom,
  resolveServerPackageRoot,
  findLockfileNear,
} from './sbom.js';
export {
  validateFinding,
  rejectFinding,
  markDisclosed,
  autoValidateEligible,
  isNoiseFinding,
  isNovelOrPreAdvisory,
  isRuntimeNovelFinding,
  isAdvisoryDependencyFinding,
  discoveryLane,
  purgeNoiseFindings,
  deletePoisonedNvdCaches,
} from './validate.js';
export type { ValidationSignals, ValidationResult, PurgeNoiseResult, DiscoveryLane } from './validate.js';
export {
  shouldUpsertCveFinding,
  packageAppearsInCveText,
} from './supply-chain-scanner.js';
export { scanServerSupplyChain } from './supply-chain-scanner.js';
export { scanServerSast } from './sast-scanner.js';
export { scanToolResponse, scanToolResultText } from './response-scanner.js';
export {
  generateFuzzPayloads,
  findingFromFuzzResult,
  getFuzzDepthFromEnv,
  isMaliciousArgs,
} from './mcp-tool-fuzzer.js';
export {
  fuzzServerTools,
  fuzzMcpServers,
  openStdioFuzzTransport,
  openProxyHttpFuzzTransport,
} from './mcp-fuzz-runner.js';
export type { McpFuzzTransport, McpFuzzRunnerOptions, McpFuzzRunResult } from './mcp-fuzz-runner.js';
export {
  classifyExploitEffect,
  hasProvenExploitEffect,
  isSoftDenyText,
  EXPLOIT_EFFECT_RULE,
  EXPLOIT_EFFECT_DECISION,
} from './effect-classifier.js';
export { tapAllowedToolCall, isLiveTrafficTapEnabled } from './live-traffic-tap.js';
export { reproFinding, reproNovelCandidates } from './repro-agent.js';
export type { ReproResult } from './repro-agent.js';
export {
  getLiveTrafficStats,
  sortToolsByLiveHotness,
  recordLiveAllow,
  recordMaliciousShaped,
} from './live-traffic-stats.js';
export type { LiveTrafficStat } from './live-traffic-stats.js';
export {
  getPrecisionMetrics,
  novelPrecisionSummary,
  recordPrecisionEvent,
} from './precision-metrics.js';
export type { PrecisionBucket } from './precision-metrics.js';
export {
  coverageAgent,
  differentialAgent,
  prioritizerAgent,
  benignArgsFromTool,
} from './specialized-agents.js';
export { buildAgentStackGraph, sliceGraphAround } from './stack-graph.js';
export { probeUpstreamApi, probeUpstreamApis } from './upstream-api-prober.js';
export {
  evaluateBehavioralAndRecord,
  scoreBehavioralAnomaly,
} from './behavioral.js';
export { shareBehavioralFingerprint, loadRecentBehavioralHints } from './federated-behavioral.js';
export {
  analyzeFinding,
  analyzeAll,
  loadReport,
  saveReport,
  onFindingValidated,
  buildContextPack,
  isVulnAnalysisEnabled,
  approveAnalysisReport,
  allowVulnAnalysisTemplateFallback,
  ensureVulnAnalysisLlmEnabled,
  VulnAnalysisLlmUnavailableError,
} from './vuln-analyst.js';
export {
  buildDisclosurePackage,
  prepareDisclosurePackage,
  readDisclosurePackageZip,
  loadDisclosurePackageMeta,
  zipStoreFiles,
} from './disclosure-package.js';
export type { DisclosurePackage, DisclosureCveStatus } from './disclosure-package.js';
export { proposeBlockFromFinding } from './propose-block.js';
export type { ProposeBlockResult } from './propose-block.js';
export {
  runAgenticVulnDiscovery,
  agenticPromoteFinding,
} from './agentic-orchestrator.js';
export type { AgenticVulnRunOptions, AgenticVulnRunResult } from './agentic-orchestrator.js';
export { runVulnDiscovery } from './engine.js';
export type { VulnDiscoveryRunOptions, VulnDiscoveryRunResult } from './engine.js';
