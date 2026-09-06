/**
 * Tool Security Classification Catalog for DIFC
 *
 * Maps MCP and agent tool definitions into formal Source / Sink / Internal profiles.
 */
import type { ToolSecurityProfile, SecrecyTag, IntegrityTag } from './difc-types.js';

const SENSITIVE_READ_PATTERNS = [
  /\b(?:read|get|fetch|view|download|dump|select|cat|tail|head)\b/i,
  /\b(?:credential|secret|password|token|key|private|auth|session)\b/i,
  /\b(?:address|payment|bank|card|ssn|contact|profile|history)\b/i,
];

const EGRESS_SINK_PATTERNS = [
  /\b(?:send|post|upload|publish|forward|notify|transmit|webhook|broadcast|emit)\b/i,
  /\b(?:http|request|curl|wget|fetch_url|email|mail|sms|slack|discord|telegram|tweet)\b/i,
];

/** Default catalog of standard tools */
const KNOWN_TOOL_PROFILES: Record<string, ToolSecurityProfile> = {
  // Sensitive Sources: Filesystem & Secrets
  read_file: {
    type: 'source',
    producesSecrecy: ['filesystem_private'],
    egressClearance: new Set(),
  },
  read_text_file: {
    type: 'source',
    producesSecrecy: ['filesystem_private'],
    egressClearance: new Set(),
  },
  get_credentials: {
    type: 'source',
    producesSecrecy: ['credentials', 'confidential'],
    egressClearance: new Set(),
  },
  read_api_key: {
    type: 'source',
    producesSecrecy: ['credentials', 'session_token'],
    egressClearance: new Set(),
  },

  // Sensitive Sources: InjecAgent / Commercial Assistant Tools
  AmazonViewSavedAddresses: {
    type: 'source',
    producesSecrecy: ['pii', 'confidential'],
    egressClearance: new Set(),
  },
  AmazonViewSavedPaymentMethods: {
    type: 'source',
    producesSecrecy: ['financial', 'credentials'],
    egressClearance: new Set(),
  },
  GmailReadEmails: {
    type: 'source',
    producesSecrecy: ['email_private', 'confidential'],
    egressClearance: new Set(),
  },
  GoogleContactsGetContacts: {
    type: 'source',
    producesSecrecy: ['pii', 'confidential'],
    egressClearance: new Set(),
  },
  get_user_profile: {
    type: 'source',
    producesSecrecy: ['pii'],
    egressClearance: new Set(),
  },
  fetch_financial_record: {
    type: 'source',
    producesSecrecy: ['financial', 'confidential'],
    egressClearance: new Set(),
  },

  // Untrusted Web Ingestion Sources (Integrity Taint)
  fetch_webpage: {
    type: 'source',
    producesIntegrity: ['untrusted_web'],
    egressClearance: new Set(),
  },
  web_search: {
    type: 'source',
    producesIntegrity: ['untrusted_web'],
    egressClearance: new Set(),
  },
  read_untrusted_input: {
    type: 'source',
    producesIntegrity: ['untrusted_third_party'],
    egressClearance: new Set(),
  },

  // Egress Sinks: Network / Email / Messaging / Webhooks (Zero Egress Clearance by default)
  http_request: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
  post_webhook: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
  send_email: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
  GmailSendEmail: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
  send_message: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
  upload_file: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
  curl: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
  bash: {
    type: 'sink',
    egressClearance: new Set(),
    requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
  },
};

function splitIdentifier(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

/**
 * Classifies a tool dynamically based on its name and arguments if not statically registered.
 */
export function getToolSecurityProfile(toolName: string): ToolSecurityProfile {
  if (KNOWN_TOOL_PROFILES[toolName]) {
    return KNOWN_TOOL_PROFILES[toolName];
  }

  const normalized = splitIdentifier(toolName);

  // Heuristic matching on split words
  const isSink =
    EGRESS_SINK_PATTERNS.some((p) => p.test(normalized)) ||
    /\b(?:send|email|mail|post|webhook|upload|transmit|forward|notify|curl|request|message|publish|share|tweet|sms)\b/i.test(
      normalized,
    );

  const isSource =
    SENSITIVE_READ_PATTERNS.some((p) => p.test(normalized)) ||
    /\b(?:get|read|fetch|view|download|search|list|dump|query|inspect|access|history|record|details?|info|data|contact|payment|account|order|profile|password|credential|prescriptions?|generate|create|synthesize|deepfake|clone|extract)\b/i.test(
      normalized,
    );

  if (isSink && !isSource) {
    return {
      type: 'sink',
      egressClearance: new Set(),
      requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
    };
  }

  if (isSource && !isSink) {
    const isCredentials = /credential|secret|password|token|key|auth|session/i.test(normalized);
    const isFinancial = /payment|card|bank|account|order|holding|transaction|venmo|binance|tdameritrade/i.test(normalized);
    const isPii = /address|contact|profile|user|patient|people|identity|spokeo|facebook|teladoc|prescription|genetic|23andme|location/i.test(normalized);
    const isFilesystem = /file|dir|cat|path|item|document|cloud|dropbox/i.test(normalized);

    const tags: SecrecyTag[] = ['confidential'];
    if (isCredentials) tags.push('credentials');
    if (isFinancial) tags.push('financial');
    if (isPii) tags.push('pii');
    if (isFilesystem) tags.push('filesystem_private');

    return {
      type: 'source',
      producesSecrecy: tags,
      egressClearance: new Set(),
    };
  }

  if (isSink && isSource) {
    // Bidirectional tool like a messaging or email app that can both read and send
    if (/\b(?:send|post|transmit|forward)\b/i.test(normalized)) {
      return {
        type: 'sink',
        egressClearance: new Set(),
        requiredIntegrity: new Set(['trusted_system', 'trusted_user']),
      };
    }
  }

  // Internal / general utility by default
  return {
    type: 'internal',
    egressClearance: new Set(['confidential', 'filesystem_private', 'pii', 'financial']),
  };
}

