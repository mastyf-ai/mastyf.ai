import { CveChecker } from './scanners/cve-checker.js';
import { AuthProber } from './scanners/auth-prober.js';
import { TypoSquatDetector } from './scanners/typo-squat-detector.js';
import { SecretScanner } from './scanners/secret-scanner.js';
import { SecurityScanner } from './services/security-scanner.js';
import { CostAuditor } from './services/cost-auditor.js';
import { HealthMonitor } from './services/health-monitor.js';
import { HistoryDatabase } from './database/history-db.js';
import { PricingClient } from './clients/pricing-client.js';

export interface Container {
  db: HistoryDatabase;
  securityScanner: SecurityScanner;
  costAuditor: CostAuditor;
  healthMonitor: HealthMonitor;
}

export function createContainer(dbPath?: string): Container {
  const db = new HistoryDatabase(dbPath);
  const cveChecker = new CveChecker();
  const authProber = new AuthProber();
  const typoDetector = new TypoSquatDetector();
  const secretScanner = new SecretScanner();
  const securityScanner = new SecurityScanner(cveChecker, authProber, typoDetector, secretScanner);
  const pricingClient = new PricingClient();
  const costAuditor = new CostAuditor(pricingClient);
  const healthMonitor = new HealthMonitor(db);

  return { db, securityScanner, costAuditor, healthMonitor };
}