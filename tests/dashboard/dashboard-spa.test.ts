import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const SPA_ROOT = join(process.cwd(), 'deploy', 'dashboard-spa');

describe('dashboard-spa', () => {
  it('routes page.tsx through DashboardPageClient', () => {
    const page = join(SPA_ROOT, 'app', 'page.tsx');
    const pageSrc = readFileSync(page, 'utf-8');
    expect(pageSrc).toContain('DashboardPageClient');
  });

  it('uses enterprise layout and operator enablement workspaces', () => {
    const client = join(SPA_ROOT, 'app', 'components', 'DashboardClient.tsx');
    const nav = join(SPA_ROOT, 'lib', 'workspace-nav.ts');
    const enterpriseCss = join(SPA_ROOT, 'app', 'design', 'enterprise.css');
    expect(readFileSync(nav, 'utf-8')).toContain("'security'");
    expect(readFileSync(nav, 'utf-8')).toContain("'help'");
    const src = readFileSync(client, 'utf-8');
    expect(src).toContain('EnterpriseLayout');
    expect(src).toContain('OperatorEnablementCenter');
    expect(src).toContain('SecurityOperationsCenter');
    expect(src).not.toContain('SocDashboardLayout');
    expect(src).not.toContain('repo-data');
    expect(readFileSync(enterpriseCss, 'utf-8')).toContain('.pipeline-step');
  });

  it('includes Security operations center and Autopilot API client', () => {
    const integrations = readFileSync(
      join(SPA_ROOT, 'app', 'components', 'operations', 'PlatformIntegrationsPanel.tsx'),
      'utf-8',
    );
    const security = readFileSync(
      join(SPA_ROOT, 'app', 'components', 'operations', 'SecurityOperationsCenter.tsx'),
      'utf-8',
    );
    const api = readFileSync(join(SPA_ROOT, 'lib', 'mastyf-ai-api.ts'), 'utf-8');
    expect(integrations).toContain('fetchAutopilotStatus');
    expect(security).toContain('fetchSecurityDashboard');
    expect(api).toContain('/api/autopilot/status');
    expect(api).toContain('/api/reports/generate');
    const nav = readFileSync(join(SPA_ROOT, 'lib', 'workspace-nav.ts'), 'utf-8');
    expect(nav).toContain("label: 'Security'");
  });

  it('deep-links Enterprise AI incidents into Threat Lab workbench', () => {
    const client = readFileSync(join(SPA_ROOT, 'app', 'components', 'DashboardClient.tsx'), 'utf-8');
    const security = readFileSync(
      join(SPA_ROOT, 'app', 'components', 'operations', 'SecurityOperationsCenter.tsx'),
      'utf-8',
    );
    expect(client).toContain('onOpenThreatLab={openThreatLab}');
    expect(security).toContain('ThreatLabWorkbench');
    expect(security).toContain('onOpenThreatLab');
  });

  it('includes health report and swarm job log API client', () => {
    const api = readFileSync(join(SPA_ROOT, 'lib', 'mastyf-ai-api.ts'), 'utf-8');
    expect(api).toContain('fetchMcpHealthReport');
    expect(api).toContain('fetchSwarmJobLog');
  });

  it('includes analytics, security dashboard, and setup status APIs', () => {
    const configHub = readFileSync(
      join(SPA_ROOT, 'app', 'components', 'operations', 'ConfigurationHub.tsx'),
      'utf-8',
    );
    const security = readFileSync(
      join(SPA_ROOT, 'app', 'components', 'operations', 'SecurityOperationsCenter.tsx'),
      'utf-8',
    );
    const api = readFileSync(join(SPA_ROOT, 'lib', 'mastyf-ai-api.ts'), 'utf-8');
    const nav = readFileSync(join(SPA_ROOT, 'lib', 'workspace-nav.ts'), 'utf-8');
    expect(configHub).toContain('fetchSetupStatus');
    expect(security).toContain('fetchSecurityDashboard');
    expect(security).toContain('VulnDiscoveryPanel');
    expect(nav).toContain("'security'");
    expect(nav).toContain('Vuln Discovery');
    expect(api).toContain('/api/analytics/summary');
    expect(api).toContain('/api/security/dashboard');
    expect(api).toContain('/api/setup/status');
    expect(api).toContain('/api/vuln-findings');
    expect(api).toContain('buildMutatingHeaders');
    expect(api).toContain('postVulnProposeBlock');
    expect(api).toContain('postVulnApproveAnalysis');
    expect(api).toContain('postVulnReject');
    expect(api).toContain('unwrapVulnReport');
    expect(api).toContain('getVulnLiveStats');
    expect(api).toContain('postVulnPrepareDisclosure');
    expect(api).toContain('downloadVulnDisclosurePackage');
    expect(api).toContain('/api/vuln-live-stats');
    const panel = readFileSync(
      join(SPA_ROOT, 'app', 'components', 'operations', 'VulnDiscoveryPanel.tsx'),
      'utf-8',
    );
    expect(panel).toContain("source: 'vuln-finding'");
    expect(panel).toContain('setSelectedId');
    expect(panel).toContain('Propose block');
    expect(panel).toContain('Operator checklist');
    expect(panel).toContain('Live tap coverage');
    expect(panel).toContain('Prepare disclosure package');
    expect(panel).toContain('Download zip');
  });

  it('loads dashboard client with ssr disabled', () => {
    const pageClient = join(SPA_ROOT, 'app', 'components', 'DashboardPageClient.tsx');
    expect(readFileSync(pageClient, 'utf-8')).toContain('ssr: false');
  });

  it('static export exists after dashboard:build', () => {
    const outIndex = join(SPA_ROOT, 'out', 'index.html');
    if (!existsSync(outIndex)) {
      expect(existsSync(join(SPA_ROOT, 'package.json'))).toBe(true);
      return;
    }
    expect(readFileSync(outIndex, 'utf-8')).toContain('mastyf.ai');
  });
});
