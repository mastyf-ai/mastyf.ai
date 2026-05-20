/**
 * Scan image/audio/document fields in tool arguments for prompt-injection text.
 */
import { walkStringLeaves } from '../policy/arg-leaf-walker.js';
import { detectPromptInjection } from './prompt-injection-detector.js';

const MULTIMODAL_KEYS = new Set([
  'alt',
  'alt_text',
  'alttext',
  'caption',
  'description',
  'transcript',
  'transcription',
  'ocr',
  'text',
  'content',
  'title',
  'label',
  'summary',
  'data',
]);

export interface MultimodalFinding {
  field: string;
  patternId: string;
  description: string;
  severity: string;
}

function isMultimodalPath(path: string): boolean {
  const parts = path.split(/[.[\]]/).filter(Boolean).map((p) => p.toLowerCase());
  return parts.some((p) => MULTIMODAL_KEYS.has(p) || p.includes('image') || p.includes('audio') || p.includes('pdf'));
}

export function scanMultimodalContent(args: Record<string, unknown> | undefined): MultimodalFinding[] {
  if (!args) return [];
  const findings: MultimodalFinding[] = [];
  for (const leaf of walkStringLeaves(args)) {
    if (!isMultimodalPath(leaf.path) && leaf.value.length < 200) continue;
    const hits = detectPromptInjection('multimodal', leaf.value);
    for (const h of hits) {
      findings.push({
        field: leaf.path,
        patternId: h.patternId,
        description: h.description,
        severity: h.severity,
      });
    }
  }
  return findings;
}
