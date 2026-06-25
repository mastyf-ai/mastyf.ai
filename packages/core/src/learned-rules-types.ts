export type LearnedRuleTarget = "argument" | "local-semantic";

export type LearnedRuleProvenance = {
  attackClass: string;
  hypothesis: string;
  confidence: number;
  fingerprint: string;
  source: string;
  promotedAt: string;
};

export type LearnedRuleDef = {
  id: string;
  target: LearnedRuleTarget;
  regex: string;
  category: string;
  severity: "critical" | "warning";
  weight: number;
  message: string;
  probe: string;
  provenance: LearnedRuleProvenance;
};

export type LearnedRulesFile = {
  version: 1;
  updatedAt: string;
  rules: LearnedRuleDef[];
};
