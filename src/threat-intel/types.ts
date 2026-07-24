export interface ThreatFeedDb {
  addEntry(entry: {
    signatureHash: string;
    toolPattern: string;
    argPatternHash: string;
    category: string;
    blockReason: string;
    source: string;
  }): void;
}
