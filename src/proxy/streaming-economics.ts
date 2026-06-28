/**
 * Unified mid-stream spend cutoff (Defense Fabric phase 4).
 */
import {
  createStreamingInspectorState,
  type StreamingInspectorState,
} from '../utils/streaming-inspector.js';
import { inspectCostStreamingChunk } from '../agentic/response-dlp/cost-streaming-inspector.js';
import { releaseReservedSpend } from '../services/unified-spend-pool.js';

export interface StreamingEconomicsState {
  costState: StreamingInspectorState;
  tenantId: string;
  spendReservationId?: string;
  aborted: boolean;
}

export function createStreamingEconomicsState(
  tenantId: string,
  spendReservationId?: string,
): StreamingEconomicsState {
  return {
    costState: createStreamingInspectorState(),
    tenantId: tenantId || 'default',
    spendReservationId,
    aborted: false,
  };
}

export interface StreamingEconomicsChunkResult {
  abort: boolean;
  reason?: string;
}

/** Inspect one upstream chunk; abort stream when tenant spend cap exceeded. */
export function inspectStreamingEconomicsChunk(
  state: StreamingEconomicsState,
  chunk: string,
): StreamingEconomicsChunkResult {
  if (state.aborted) {
    return { abort: true, reason: 'stream already aborted' };
  }
  const costCheck = inspectCostStreamingChunk(state.costState, chunk, state.tenantId);
  if (costCheck.terminateStream) {
    state.aborted = true;
    if (state.spendReservationId) {
      void releaseReservedSpend(state.spendReservationId);
    }
    return {
      abort: true,
      reason: costCheck.reason ?? 'Streaming spend cap exceeded',
    };
  }
  return { abort: false };
}
