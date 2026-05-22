/**
 * Burkhard-Keller tree for fast approximate string matching (Levenshtein distance).
 * Used by TypoSquatDetector to avoid O(n) linear scan over trusted package corpus.
 */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

interface BKNode {
  term: string;
  children: Map<number, BKNode>;
}

export class BKTree {
  private root: BKNode | null = null;

  get size(): number {
    return this.countNodes(this.root);
  }

  private countNodes(node: BKNode | null): number {
    if (!node) return 0;
    let n = 1;
    for (const child of node.children.values()) {
      n += this.countNodes(child);
    }
    return n;
  }

  insert(term: string): void {
    if (!term) return;
    if (!this.root) {
      this.root = { term, children: new Map() };
      return;
    }
    let node = this.root;
    while (true) {
      const dist = levenshtein(term, node.term);
      if (dist === 0) return;
      const child = node.children.get(dist);
      if (!child) {
        node.children.set(dist, { term, children: new Map() });
        return;
      }
      node = child;
    }
  }

  /** Return indexed terms within maxDistance of query. */
  search(query: string, maxDistance: number): string[] {
    if (!this.root || maxDistance < 0) return [];
    const out: string[] = [];
    const stack: BKNode[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const dist = levenshtein(query, node.term);
      if (dist <= maxDistance) out.push(node.term);
      const low = dist - maxDistance;
      const high = dist + maxDistance;
      for (const [edge, child] of node.children) {
        if (edge >= low && edge <= high) stack.push(child);
      }
    }
    return out;
  }
}
