import { describe, it, expect } from 'vitest';
import { runPlanComplianceAudit } from '../../src/agentic/plan-compliance-audit.js';
import { scoreGraphEventsWithOnnx } from '../../src/agentic/cross-chain/graph-onnx-inference.js';
import { pullCloudObservatorySnapshot } from '../../src/agentic/observatory/observatory-cloud-relay.js';
import { DigitalTwinCapture } from '../../src/agentic/digital-twin/twin-capture.js';

describe('plan compliance audit', () => {
  it('runs full A1–C5 / B1–B3 audit with 11 modules', async () => {
    const report = await runPlanComplianceAudit();
    expect(report.modules).toHaveLength(11);
    expect(report.overallScore).toBeGreaterThanOrEqual(80);
    expect(report.generatedAt).toBeTruthy();
    expect(report.modules.every(m => m.score >= 0)).toBe(true);
  });

  it('A1 ONNX path returns null without model file', async () => {
    delete process.env.GUARDIAN_FLEET_GRAPH_ONNX_MODEL;
    const result = await scoreGraphEventsWithOnnx([
      {
        globalSessionId: 's',
        agentId: 'a',
        serverName: 'fs',
        toolName: 'read_file',
        eventType: 'tool_call',
        blocked: false,
        timestamp: 1,
      },
    ]);
    expect(result).toBeNull();
  });

  it('B2 observatory stub returns cloud payload without relay URL', async () => {
    process.env.GUARDIAN_OBSERVATORY_STUB = 'true';
    delete process.env.GUARDIAN_OBSERVATORY_RELAY_URL;
    delete process.env.GUARDIAN_CLOUD_URL;
    const payload = await pullCloudObservatorySnapshot();
    delete process.env.GUARDIAN_OBSERVATORY_STUB;
    expect(payload?.avgBlockRate).toBeGreaterThan(0);
    expect(payload?.serverCount).toBeGreaterThan(0);
  });

  it('A2 scorecard downgrades when captured traffic missing', () => {
    const twin = new DigitalTwinCapture();
    const score = twin.scoreSandbox({
      attacksBlocked: 10,
      attacksTotal: 10,
      workflowsPreserved: 100,
      workflowsTotal: 100,
      baselineP99Ms: 100,
      sandboxP99Ms: 110,
      capturedReplayed: 0,
    });
    expect(score.goNoGo).toBe('review');
    expect(score.reason).toContain('captured');
  });
});
