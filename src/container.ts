import { CveChecker } from './scanners/cve-checker.js';
import { AuthProber } from './scanners/auth-prober.js';
import { TypoSquatDetector } from './scanners/typo-squat-detector.js';
import { SecretScanner } from './scanners/secret-scanner.js';
import { SecurityScanner } from './services/security-scanner.js';
import { CostAuditor } from './services/cost-auditor.js';
import { HealthMonitor } from './services/health-monitor.js';
import { IDatabase } from './database/database-interface.js';
import { createDatabase } from './database/create-database.js';
import { PricingClient } from './clients/pricing-client.js';
import { Logger } from './utils/logger.js';
import { bootstrapSecrets } from './utils/enterprise-bootstrap.js';
import { checkPgBouncerAtStartup } from './utils/pgbouncer-check.js';
import { validateCostSourceAtStartup } from './utils/cost-estimate.js';
import { AgenticScheduler } from './agentic/scheduler.js';
import { AgenticModelProvider } from './agentic/model-provider.js';
import { AgenticTaskQueue } from './agentic/task-queue.js';
import { AgenticTelemetry } from './agentic/telemetry.js';
import { ApprovalGate } from './agentic/core.js';
import { BehaviorCollector } from './agentic/policy-gen/behavior-collector.js';
import { PatternAnalyzer } from './agentic/policy-gen/pattern-analyzer.js';
import { PolicySynthesizer } from './agentic/policy-gen/policy-synthesizer.js';
import { PolicyDiff } from './agentic/policy-gen/policy-diff.js';
import { PromptInjectionDetector } from './agentic/prompt-injection/detector.js';
import { ArgumentSanitizer } from './agentic/prompt-injection/argument-sanitizer.js';
import { RiskScorer } from './agentic/threat-prediction/risk-scorer.js';
import { ThreatPredictor } from './agentic/threat-prediction/predictor.js';
import { SignatureVerifier } from './agentic/supply-chain/signature-verifier.js';
import { DriftDetector } from './agentic/drift/drift-detector.js';
import { ControlMapper } from './agentic/compliance/control-mapper.js';
import { AttackGenerator } from './agentic/red-team/attack-generator.js';
import { ThreatMeshNode } from './agentic/threat-mesh/mesh-node.js';
import { HoneypotManager } from './agentic/honeypot/honeypot-manager.js';
import { TrustNegotiationProtocol } from './agentic/trust-negotiation/protocol.js';
import { GuardianScore } from './agentic/trust-score/guardian-score.js';
import { ResponseDlpScanner } from './agentic/response-dlp/response-scanner.js';
import { MCPCertifier } from './agentic/certification/certifier.js';
import { McpProtocolFuzzer } from './agentic/protocol-fuzzer/mcp-fuzzer.js';
import { CollusionDetector } from './agentic/collusion-detector/collusion-watch.js';
import { SlaEnforcer } from './agentic/sla-enforcer/sla-tracker.js';
import { IncidentPlaybookRunner } from './agentic/incident-playbook/playbook-runner.js';
import { ReputationEngine } from './agentic/agent-reputation/reputation-engine.js';
import { ConfigHardener } from './agentic/config-hardener/hardening-advisor.js';
import { ThompsonSamplingAgentTrust } from './agentic/rl/thompson-sampling.js';
import { ContextualBanditPolicyTuner } from './agentic/rl/contextual-bandit.js';
import { SarsaThresholdAdapter } from './agentic/rl/sarsa-thresholds.js';
import { ReinforceFuzzerSelector } from './agentic/rl/reinforce-fuzzer.js';
import { StreamingResponseDlpInspector } from './agentic/response-dlp/streaming-inspector.js';
import { McpLifecycleGuard } from './agentic/mcp-lifecycle/lifecycle-guard.js';
import { RequestAuditor } from './agentic/audit/request-auditor.js';
import { IndustryStandardStore } from './database/industry-standard-store.js';
import { CapabilityGraphBuilder } from './agentic/capability-graph/graph-builder.js';
import { IntentEngine } from './agentic/intent-binding/intent-engine.js';
import { SandboxTierEnforcer } from './agentic/sandbox-tier/enforcer.js';
import { ComplianceEvidenceRunner } from './agentic/compliance/compliance-evidence-runner.js';
import { BehaviorFingerprintEngine } from './agentic/biometrics/behavior-fingerprint.js';
import { ConfigProvenanceChain, getConfigProvenanceChain } from './agentic/provenance/config-provenance-chain.js';
import { FleetChainDetector } from './agentic/cross-chain/fleet-chain-detector.js';
import { DigitalTwinCapture } from './agentic/digital-twin/twin-capture.js';
import { ZeroTrustVerificationEngine } from './agentic/zero-trust/verification-engine.js';
import { ReputationNetwork } from './agentic/reputation/reputation-network.js';
import { EcosystemObservatory } from './agentic/observatory/ecosystem-observatory.js';
import { InsuranceRiskQuantifier } from './agentic/insurance/risk-quantifier.js';
import { FederatedLearningCoordinator } from './agentic/federated/federated-learning.js';

export interface Container {
  db: IDatabase;
  securityScanner: SecurityScanner;
  costAuditor: CostAuditor;
  healthMonitor: HealthMonitor;
  // Agentic AI services
  agenticScheduler: AgenticScheduler;
  modelProvider: AgenticModelProvider;
  taskQueue: AgenticTaskQueue;
  telemetry: AgenticTelemetry;
  approvalGate: ApprovalGate;
  // Feature modules
  behaviorCollector: BehaviorCollector;
  patternAnalyzer: PatternAnalyzer;
  policySynthesizer: PolicySynthesizer;
  policyDiff: PolicyDiff;
  promptInjectionDetector: PromptInjectionDetector;
  argumentSanitizer: ArgumentSanitizer;
  riskScorer: RiskScorer;
  threatPredictor: ThreatPredictor;
  signatureVerifier: SignatureVerifier;
  driftDetector: DriftDetector;
  controlMapper: ControlMapper;
  attackGenerator: AttackGenerator;
  threatMeshNode: ThreatMeshNode;
  honeypotManager: HoneypotManager;
  trustProtocol: TrustNegotiationProtocol;
  guardianScore: GuardianScore;
  responseDlp: ResponseDlpScanner;
  certifier: MCPCertifier;
  protocolFuzzer: McpProtocolFuzzer;
  collusionDetector: CollusionDetector;
  slaEnforcer: SlaEnforcer;
  incidentPlaybook: IncidentPlaybookRunner;
  reputationEngine: ReputationEngine;
  configHardener: ConfigHardener;
  thompsonSampling: ThompsonSamplingAgentTrust;
  contextualBandit: ContextualBanditPolicyTuner;
  sarsaThresholds: SarsaThresholdAdapter;
  reinforceFuzzer: ReinforceFuzzerSelector;
  streamingDlp: StreamingResponseDlpInspector;
  lifecycleGuard: McpLifecycleGuard;
  requestAuditor: RequestAuditor;
  industryStore: IndustryStandardStore;
  capabilityGraph: CapabilityGraphBuilder;
  intentEngine: IntentEngine;
  sandboxEnforcer: SandboxTierEnforcer;
  complianceEvidence: ComplianceEvidenceRunner;
  behaviorFingerprint: BehaviorFingerprintEngine;
  configProvenance: ConfigProvenanceChain;
  fleetChainDetector: FleetChainDetector;
  digitalTwin: DigitalTwinCapture;
  zeroTrustEngine: ZeroTrustVerificationEngine;
  reputationNetwork: ReputationNetwork;
  ecosystemObservatory: EcosystemObservatory;
  insuranceRiskQuantifier: InsuranceRiskQuantifier;
  federatedLearning: FederatedLearningCoordinator;
}

let startupWarningEmitted = false;

export async function createContainer(dbPath?: string): Promise<Container> {
  await bootstrapSecrets();
  validateCostSourceAtStartup();
  checkPgBouncerAtStartup();
  const db = await createDatabase(dbPath);
  const cveChecker = new CveChecker();
  const authProber = new AuthProber();
  const typoDetector = new TypoSquatDetector();
  const secretScanner = new SecretScanner();
  const securityScanner = new SecurityScanner(cveChecker, authProber, typoDetector, secretScanner);
  const pricingClient = new PricingClient();
  const costAuditor = new CostAuditor(pricingClient, db);
  const healthMonitor = new HealthMonitor(db);

  // ── Redis-not-configured warning (once per startup) ──────
  if (!startupWarningEmitted) {
    startupWarningEmitted = true;
    const { isRedisConfigured } = await import('./utils/redis-client.js');
    if (!isRedisConfigured()) {
      const replicaCount = parseInt(process.env['REPLICA_COUNT'] ?? '1', 10);
      const inK8s = !!process.env['KUBERNETES_SERVICE_HOST'];
      if (replicaCount > 1 || inK8s) {
        Logger.error(
          `[Container] ⛔ CRITICAL: Redis is NOT configured but running in a multi-replica or K8s environment.\n` +
            `  • Rate limits are per-pod (not enforced globally)\n` +
            `  • Session tokens issued by pod A are invalid on pod B\n` +
            `  • Replay protection is ineffective\n` +
            `  • Cross-region active-active is not supported (>80ms RTT breaks locks)\n` +
            `  Set REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES (single-region). See docs/REDIS_HA.md.`
        );
        if (process.env['GUARDIAN_STRICT_MODE'] === 'true') {
          process.exit(1);
        }
      } else {
        Logger.warn(
          `[Container] Redis not configured: using in-memory rate limiting and session store. ` +
            `This is NOT suitable for multi-replica deployment.`
        );
      }
    }
  }

  // ── Agentic AI services ──────────────────────────────────────
  const agenticScheduler = new AgenticScheduler();
  const modelProvider = new AgenticModelProvider();
  const taskQueue = new AgenticTaskQueue(3);
  const telemetry = new AgenticTelemetry();
  const approvalGate = new ApprovalGate();
  const industryStore = new IndustryStandardStore(db);
  const { bindPolicyApprovalStore } = await import('./agentic/semantic-policy/policy-approval-store.js');
  bindPolicyApprovalStore(industryStore);

  // Feature modules
  const behaviorCollector = new BehaviorCollector();
  const patternAnalyzer = new PatternAnalyzer();
  const policySynthesizer = new PolicySynthesizer();
  const policyDiff = new PolicyDiff();
  const promptInjectionDetector = new PromptInjectionDetector(modelProvider);
  const argumentSanitizer = new ArgumentSanitizer();
  const riskScorer = new RiskScorer();
  const threatPredictor = new ThreatPredictor();
  const signatureVerifier = new SignatureVerifier();
  const driftDetector = new DriftDetector();
  const controlMapper = new ControlMapper();
  const attackGenerator = new AttackGenerator();
  const threatMeshNode = new ThreatMeshNode(industryStore);
  const honeypotManager = new HoneypotManager();
  const trustProtocol = new TrustNegotiationProtocol();
  const guardianScore = new GuardianScore();
  const reputationNetwork = new ReputationNetwork(industryStore, guardianScore);
  const certifier = new MCPCertifier(industryStore, guardianScore, reputationNetwork);
  const protocolFuzzer = new McpProtocolFuzzer(industryStore);
  const collusionDetector = new CollusionDetector(industryStore);
  const slaEnforcer = new SlaEnforcer();
  const incidentPlaybook = new IncidentPlaybookRunner(approvalGate, industryStore);
  const reputationEngine = new ReputationEngine(industryStore);
  const configHardener = new ConfigHardener();
  const thompsonSampling = new ThompsonSamplingAgentTrust();
  const contextualBandit = new ContextualBanditPolicyTuner();
  const sarsaThresholds = new SarsaThresholdAdapter();
  const reinforceFuzzer = new ReinforceFuzzerSelector();
  const streamingDlp = new StreamingResponseDlpInspector();
  const lifecycleGuard = new McpLifecycleGuard();
  const requestAuditor = new RequestAuditor();
  const capabilityGraph = new CapabilityGraphBuilder(industryStore);
  const intentEngine = new IntentEngine(industryStore);
  const sandboxEnforcer = new SandboxTierEnforcer(industryStore);
  const complianceEvidence = new ComplianceEvidenceRunner(db, industryStore);
  const behaviorFingerprint = new BehaviorFingerprintEngine(industryStore);
  behaviorCollector.setFingerprintEngine(behaviorFingerprint);
  const configProvenance = getConfigProvenanceChain(industryStore);
  const fleetChainDetector = new FleetChainDetector(industryStore);
  const digitalTwin = new DigitalTwinCapture(industryStore);
  const zeroTrustEngine = new ZeroTrustVerificationEngine(reputationEngine, behaviorFingerprint, intentEngine, certifier, approvalGate);
  const responseDlp = new ResponseDlpScanner();
  const ecosystemObservatory = new EcosystemObservatory(industryStore);
  const insuranceRiskQuantifier = new InsuranceRiskQuantifier(threatPredictor, riskScorer, industryStore);
  const federatedLearning = new FederatedLearningCoordinator(approvalGate, contextualBandit, industryStore);
  if (process.env.GUARDIAN_FEDERATED_LEARNING === 'true') {
    federatedLearning.getActiveWeights();
    void federatedLearning.syncRemoteDeltas().then(() => {
      const min = Number(process.env.GUARDIAN_FEDERATED_LEARNING_MIN_REPORTS ?? 3);
      federatedLearning.aggregateDeltas(min);
    });
  }

  Logger.info('[Container] Agentic AI services initialized (42 modules + roadmap)');

  if (process.env.GUARDIAN_AGENTIC_ENABLED !== 'false') {
    const { registerIndustryStandardTasks } = await import('./utils/industry-standard-bootstrap.js');
    registerIndustryStandardTasks({
      db,
      securityScanner,
      costAuditor,
      healthMonitor,
      agenticScheduler,
      modelProvider,
      taskQueue,
      telemetry,
      approvalGate,
      behaviorCollector,
      patternAnalyzer,
      policySynthesizer,
      policyDiff,
      promptInjectionDetector,
      argumentSanitizer,
      riskScorer,
      threatPredictor,
      signatureVerifier,
      driftDetector,
      controlMapper,
      attackGenerator,
      threatMeshNode,
      honeypotManager,
      trustProtocol,
      guardianScore,
      responseDlp,
      certifier,
      protocolFuzzer,
      collusionDetector,
      slaEnforcer,
      incidentPlaybook,
      reputationEngine,
      configHardener,
      thompsonSampling,
      contextualBandit,
      sarsaThresholds,
      reinforceFuzzer,
      streamingDlp,
      lifecycleGuard,
      requestAuditor,
      industryStore,
      capabilityGraph,
      intentEngine,
      sandboxEnforcer,
      complianceEvidence,
      behaviorFingerprint,
      configProvenance,
      fleetChainDetector,
      digitalTwin,
      zeroTrustEngine,
      reputationNetwork,
      ecosystemObservatory,
      insuranceRiskQuantifier,
      federatedLearning,
    });
  }

  return {
    db,
    securityScanner,
    costAuditor,
    healthMonitor,
    agenticScheduler,
    modelProvider,
    taskQueue,
    telemetry,
    approvalGate,
    behaviorCollector,
    patternAnalyzer,
    policySynthesizer,
    policyDiff,
    promptInjectionDetector,
    argumentSanitizer,
    riskScorer,
    threatPredictor,
    signatureVerifier,
    driftDetector,
    controlMapper,
    attackGenerator,
    threatMeshNode,
    honeypotManager,
    trustProtocol,
    guardianScore,
    responseDlp,
    certifier,
    protocolFuzzer,
    collusionDetector,
    slaEnforcer,
    incidentPlaybook,
    reputationEngine,
    configHardener,
    thompsonSampling,
    contextualBandit,
    sarsaThresholds,
    reinforceFuzzer,
    streamingDlp,
    lifecycleGuard,
    requestAuditor,
    industryStore,
    capabilityGraph,
    intentEngine,
    sandboxEnforcer,
    complianceEvidence,
    behaviorFingerprint,
    configProvenance,
    fleetChainDetector,
    digitalTwin,
    zeroTrustEngine,
    reputationNetwork,
    ecosystemObservatory,
    insuranceRiskQuantifier,
    federatedLearning,
  };
}
