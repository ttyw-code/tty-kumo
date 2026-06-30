export class Node<T> {
    readonly incoming: Map<string, Node<T>> = new Map();
    readonly outgoing: Map<string, Node<T>> = new Map();
    constructor(readonly key: string, readonly data: T) {
    }
}

export class Graph<T> {
    private readonly _nodes: Map<string, Node<T>> = new Map();

    constructor(private readonly _hashFn: (data: T) => string) {

    }
    roots(): Node<T>[] {
        const roots: Node<T>[] = [];
        for (const node of this._nodes.values()) {
            if (node.incoming.size === 0) {
                roots.push(node);
            }
        }
        return roots;
    }
    insertEdge(from: T, to: T): void {
        const fromNode = this.lookupOrInsert(from);
        const toNode = this.lookupOrInsert(to);
        fromNode.outgoing.set(toNode.key, toNode);
        toNode.incoming.set(fromNode.key, fromNode);
    }

    removeNode(data: T): void {
        const key = this._hashFn(data);
        for (const node of this._nodes.values()) {
            node.incoming.delete(key);
            node.outgoing.delete(key);
        }
        this._nodes.delete(key);
    }

    lookupOrInsert(data: T): Node<T> {
        const key = this._hashFn(data);
        let node = this._nodes.get(key);

        if (!node) {
            node = new Node(key, data);
            this._nodes.set(key, node);
        }
        return node;
    }

    lookup(data: T): Node<T> | undefined {
        return this._nodes.get(this._hashFn(data));
    }

    isEmpty(): boolean {
        return this._nodes.size === 0;
    }

    toString(): string {
        let str: string[] = [];
        for (const [key, value] of this._nodes) {
            str.push(`${key}\n\t(-> incoming)[${[...value.incoming.keys()].join(', ')}]\n\t(outgoing ->)[${[...value.outgoing.keys()].join(',')}]\n`);
        }

        return str.join('\n');
    }

}