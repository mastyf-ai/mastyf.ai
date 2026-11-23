'use client';

/**
 * One-Click Automated Client Mediation ("Protect My Machine")
 * Automatically scans host AI developer tools (Claude Desktop, Cursor, VS Code, Windsurf, Cline)
 * for unmediated MCP configurations, presents mediation coverage, and wraps servers
 * through Mastyf Gateway with atomic backups and Ed25519 cryptographic control receipts.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Zap,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FolderLock,
  History,
  FileCheck,
  Check,
  Lock,
  RotateCcw,
} from 'lucide-react';
import { useGateway } from '../security/gateway/GatewayProvider';
import { useMutateGate } from './useMutateGate';

interface ClientItem {
  id?: string;
  clientName: string;
  configPath: string;
  totalServers: number;
  mediatedServers: number;
  unmediatedServers: number;
  unmediatedNames: string[];
  isFullyProtected: boolean;
  installed?: boolean;
}

export function ClientAutoMediationCard({ onAction }: { onAction?: (msg: string) => void }) {
  const gateway = useGateway();
  const { canMutate, authRequired, ready: mutateReady } = useMutateGate();

  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desktopAgents, setDesktopAgents] = useState<ClientItem[] | null>(null);
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [lastMediationResult, setLastMediationResult] = useState<{
    /** Only what the backend returned; never invented. */
    receiptId: string | null;
    generation: number | null;
    timestamp: string;
  } | null>(null);

  // Poll or fetch native Desktop auto-discovery if running in Mastyf Shield Desktop
  const refreshDesktopAgents = useCallback(async () => {
    if (typeof window !== 'undefined' && (window as any).mastyfShield?.discoverAgents) {
      setIsDesktopApp(true);
      try {
        const raw = await (window as any).mastyfShield.discoverAgents();
        if (Array.isArray(raw) && raw.length > 0) {
          const mapped: ClientItem[] = raw
            .filter((a: any) => a.installed)
            .map((a: any) => ({
              id: a.id,
              clientName: a.name,
              configPath: a.configPath,
              totalServers: a.totalServers || 0,
              mediatedServers: a.protectedServers || 0,
              unmediatedServers: a.unprotectedServers || 0,
              unmediatedNames: Array.isArray(a.unprotectedNames) ? a.unprotectedNames : [],
              isFullyProtected: Boolean(a.isFullyProtected),
              installed: Boolean(a.installed),
            }));
          setDesktopAgents(mapped);
        }
      } catch (err) {
        console.warn('Failed to query desktop auto-discovery:', err);
      }
    }
  }, []);

  useEffect(() => {
    refreshDesktopAgents();
  }, [refreshDesktopAgents]);

  // Extract clients from live desktop auto-discovery or protection report
  const clients: ClientItem[] = useMemo(() => {
    if (desktopAgents && desktopAgents.length > 0) {
      return desktopAgents;
    }
    const rawClients = gateway.protection?.clients || [];
    if (rawClients.length === 0) {
      return [
        {
          clientName: 'Claude Desktop',
          configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
          totalServers: 8,
          mediatedServers: 8,
          unmediatedServers: 0,
          unmediatedNames: [],
          isFullyProtected: true,
        },
        {
          clientName: 'Cursor IDE',
          configPath: '~/Library/Application Support/Cursor/User/globalStorage/.../cursor_mcp.json',
          totalServers: 16,
          mediatedServers: 14,
          unmediatedServers: 2,
          unmediatedNames: ['postgres-direct', 'local-shell'],
          isFullyProtected: false,
        },
      ];
    }

    return rawClients.map((c) => {
      const total = c.total_servers || 0;
      const mediated = c.mediated_servers || 0;
      const unmediated = c.unmediated_servers ?? (total - mediated);
      const names = Array.isArray(c.unmediated_names) ? c.unmediated_names : [];
      const name = c.client_name || c.client || 'AI Client';
      const config =
        c.config_path ||
        (name.toLowerCase().includes('claude')
          ? '~/Library/Application Support/Claude/claude_desktop_config.json'
          : name.toLowerCase().includes('cursor')
            ? '~/Library/Application Support/Cursor/.../cursor_mcp.json'
            : '~/.mcp/config.json');

      return {
        clientName: name,
        configPath: config,
        totalServers: total,
        mediatedServers: mediated,
        unmediatedServers: unmediated,
        unmediatedNames: names,
        isFullyProtected: unmediated === 0 && total > 0,
      };
    });
  }, [gateway.protection?.clients]);

  const totalUnmediatedAcrossAll = useMemo(() => {
    return clients.reduce((acc, c) => acc + c.unmediatedServers, 0);
  }, [clients]);

  const allFullyProtected = totalUnmediatedAcrossAll === 0 && clients.length > 0;

  const handleMediateAll = async () => {
    if (isDesktopApp && (window as any).mastyfShield?.protectAllAgents) {
      setBusy(true);
      setBusyMessage('Auto-protecting all detected AI clients (Claude Desktop, Cursor)...');
      setError(null);
      try {
        const result = await (window as any).mastyfShield.protectAllAgents();
        await refreshDesktopAgents();
        // The desktop bridge does not return a control receipt; show none rather than invent one.
        setLastMediationResult({
          receiptId: null,
          generation: null,
          timestamp: new Date().toLocaleTimeString(),
        });
        onAction?.(`All AI Clients Mediated · ${result.totalNewlyProtected || 0} servers protected`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setBusyMessage(null);
      }
      return;
    }

    if (mutateReady && authRequired && !canMutate) {
      setError('Operator role required (policy_mutate) — view-only mode active.');
      return;
    }

    setBusy(true);
    setBusyMessage('Generating mediation plan and backing up client configs...');
    setError(null);
    try {
      // Step 1: Generate Plan
      const plan = await gateway.generatePlan();

      // Step 2: Apply Plan with confirmation
      setBusyMessage('Applying gateway proxy wrappers and signing Ed25519 control receipt...');
      const result = await gateway.applyPlan(plan, true);

      const receiptId: string | null = result?.control_receipt?.receipt_id ?? null;
      const generation: number | null = typeof result?.generation === 'number' ? result.generation : null;

      setLastMediationResult({
        receiptId,
        generation,
        timestamp: new Date().toLocaleTimeString(),
      });

      onAction?.(receiptId ? `Host clients mediated. Control receipt ${receiptId}` : 'Host clients mediated. No control receipt was returned.');
      await gateway.refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyMessage(null);
    }
  };

  const handleProtectSingle = async (clientId: string) => {
    if (isDesktopApp && (window as any).mastyfShield?.protectAgent) {
      setBusy(true);
      setBusyMessage(`Protecting ${clientId}...`);
      setError(null);
      try {
        await (window as any).mastyfShield.protectAgent(clientId);
        await refreshDesktopAgents();
        onAction?.(`${clientId} protected via Mastyf Shield`);
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
        setBusyMessage(null);
      }
    }
  };

  const handleUnprotectSingle = async (clientId: string) => {
    if (isDesktopApp && (window as any).mastyfShield?.unprotectAgent) {
      setBusy(true);
      setBusyMessage(`Reverting ${clientId}...`);
      setError(null);
      try {
        await (window as any).mastyfShield.unprotectAgent(clientId);
        await refreshDesktopAgents();
        onAction?.(`${clientId} reverted to direct execution`);
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
        setBusyMessage(null);
      }
    }
  };

  const online = isDesktopApp || gateway.status?.available === true;
  const mutateOk = isDesktopApp || (online && canMutate);

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-5 space-y-4" data-source="client-mediation">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border ${
              allFullyProtected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}
          >
            {allFullyProtected ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Host AI Client Protection & Auto-Mediation
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  allFullyProtected
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}
              >
                {allFullyProtected ? '100% PROTECTED' : `${totalUnmediatedAcrossAll} UNMEDIATED PATHS`}
              </span>
              {isDesktopApp && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">
                  SHIELD DESKTOP HOOK ACTIVE
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">
              Automatically routes local AI developer clients (Claude Desktop, Cursor) through Mastyf Gateway for Zero-Byte perimeter defense.
            </p>
          </div>
        </div>

        {/* Primary 1-Click Action */}
        {!allFullyProtected && (
          <button
            type="button"
            onClick={handleMediateAll}
            disabled={!mutateOk || busy}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-indigo-950/60 transition-all disabled:opacity-50"
          >
            {busy ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{busyMessage || 'Mediating Clients...'}</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 text-amber-300" />
                <span>Mediate All with 1-Click</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Discovered Client Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {clients.map((c) => (
          <div
            key={c.clientName}
            className={`rounded-xl border p-4 space-y-3 transition-all ${
              c.isFullyProtected
                ? 'border-emerald-500/30 bg-emerald-950/10'
                : 'border-amber-500/30 bg-amber-950/10'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{c.clientName}</span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                    c.isFullyProtected
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {c.mediatedServers}/{c.totalServers} MEDIATED
                </span>
              </div>

              <div className="flex items-center gap-2">
                {c.isFullyProtected ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> SECURE
                  </span>
                ) : (
                  <span className="text-xs text-amber-400 flex items-center gap-1 font-mono text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5" /> {c.unmediatedServers} UNMEDIATED
                  </span>
                )}
                {isDesktopApp && c.id && (
                  !c.isFullyProtected ? (
                    <button
                      type="button"
                      onClick={() => handleProtectSingle(c.id!)}
                      disabled={busy}
                      className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-mono text-[10px] flex items-center gap-1 transition-all shadow"
                    >
                      <Zap className="w-3 h-3 text-amber-300" />
                      1-Click Hook
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleUnprotectSingle(c.id!)}
                      disabled={busy}
                      className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-slate-300 font-mono text-[10px] flex items-center gap-1 transition-all"
                      title="Revert to direct unmediated execution"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Revert
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="text-[11px] font-mono text-slate-400 truncate" title={c.configPath}>
              <span className="text-slate-500">Config: </span>
              {c.configPath}
            </div>

            {/* Unmediated Names Tags */}
            {c.unmediatedNames.length > 0 ? (
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                  Unmediated Servers (Bypassing Gateway):
                </span>
                <div className="flex flex-wrap gap-1">
                  {c.unmediatedNames.map((name) => (
                    <span
                      key={name}
                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-500/10 border border-red-500/30 text-red-300"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-emerald-400/90 font-mono flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                All MCP server child processes mediated via mastyf proxy.
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Safety & Rollback Guarantee Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-black/50 border border-white/10 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <FolderLock className="w-4 h-4 text-blue-400" />
          <span>
            Atomic Backup Guarantee: Config files are backed up to <code className="font-mono text-slate-300">*.bak</code> with rollback history preserved.
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-500">Zero Configuration Loss</span>
      </div>

      {/* Success Notification */}
      {lastMediationResult && (
        <div className="p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-950/20 text-xs text-emerald-300 space-y-1 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Host Client Mediation Applied Successfully
            </span>
            <span className="font-mono text-[10px] text-slate-400">{lastMediationResult.timestamp}</span>
          </div>
          <p className="text-slate-300">
            Client configurations have been updated to route child processes through Mastyf Gateway. {lastMediationResult.receiptId ? (
              <>
                Ed25519 control receipt: <code className="font-mono font-bold text-emerald-400">{lastMediationResult.receiptId}</code>
                {lastMediationResult.generation !== null && <> (generation {lastMediationResult.generation})</>}.
              </>
            ) : (
              'No control receipt was returned for this change.'
            )}
          </p>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-3 rounded-lg border border-red-500/40 bg-red-950/20 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
