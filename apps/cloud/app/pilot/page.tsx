import { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { PilotLifecycleSection } from '@/components/landing/PilotLifecycleSection';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

export const metadata: Metadata = {
  title: '30-Day Agent Security Pilot — Mastyf',
  description:
    'Secure one production-grade AI agent in 30 days. Deploy Mastyf Gateway in Audit Mode with zero disruption, test with Mastyf Swarm, and receive an Executive Agent Security Report for CISO sign-off.',
};

export default async function PilotPage() {
  const session = await safeAuth();

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main className="pt-24 pb-16">
        <div className="lp-section">
          <div className="lp-section-header">
            <span className="lp-pill lp-pill-gold">Guided Enterprise Engagement</span>
            <h1>30-Day AI Agent Security Pilot</h1>
            <p>
              Move from experimental agent autonomy to measurable, policy-enforced execution with zero initial workflow disruption.
            </p>
          </div>

          <PilotLifecycleSection />

          <div className="lp-pilot-form-wrap card mt-12 max-w-2xl mx-auto p-8">
            <h3 className="text-xl font-bold mb-2 text-white">Request a Guided Pilot Slot</h3>
            <p className="text-sm muted mb-6">
              Our security engineering team runs a limited cohort of 5 enterprise pilots each month.
            </p>

            <form
              action="mailto:rudraneel93@gmail.com?subject=Mastyf%2030-Day%20Agent%20Security%20Pilot%20Inquiry"
              method="POST"
              encType="text/plain"
              className="flex flex-col gap-4"
            >
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Work Email
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="name@company.com"
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-900/80 border border-slate-700 text-white text-sm focus:border-amber-400 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Target Agent Use Case
                </label>
                <select
                  name="agent_use_case"
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-900/80 border border-slate-700 text-white text-sm focus:border-amber-400 outline-none"
                >
                  <option value="mcp_tools">Model Context Protocol (MCP) Tools</option>
                  <option value="coding_agents">Coding Agents (Cursor, Claude Code, GitHub Copilot)</option>
                  <option value="internal_apis">Internal APIs / Database Execution</option>
                  <option value="customer_facing">Customer-Facing Autonomous Workflows</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Estimated Number of Connected Tools
                </label>
                <input
                  type="text"
                  name="tool_count"
                  placeholder="e.g. 5–20 tools"
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-900/80 border border-slate-700 text-white text-sm focus:border-amber-400 outline-none"
                />
              </div>

              <button type="submit" className="btn btn-primary btn-pill mt-4 w-full py-3">
                Submit Pilot Application →
              </button>
            </form>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
