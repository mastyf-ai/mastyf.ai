export declare class BKTree {
    private root;
    get size(): number;
    private countNodes;
    insert(term: string): void;
    /** Return indexed terms within maxDistance of query. */
    search(query: string, maxDistance: number): string[];
}
//# sourceMappingURL=bk-tree.d.ts.map