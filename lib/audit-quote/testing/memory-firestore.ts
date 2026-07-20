type DocData = Record<string, unknown>;

type StoredDoc = {
  data: DocData;
};

type TxOp = { type: "set"; path: string; data: DocData };

function pathOf(collection: string, id: string) {
  return `${collection}/${id}`;
}

export class MemoryFirestore {
  private docs = new Map<string, StoredDoc>();

  collection(name: string) {
    return new MemoryCollection(this, name);
  }

  async runTransaction<T>(
    fn: (transaction: MemoryTransaction) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const snapshot = this.cloneDocs();
      const tx = new MemoryTransaction(this, snapshot);
      try {
        const result = await fn(tx);
        tx.commit();
        return result;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "transaction_conflict" &&
          attempt < 11
        ) {
          await new Promise((resolve) => setTimeout(resolve, attempt));
          continue;
        }
        throw error;
      }
    }
    throw new Error("transaction_failed");
  }

  _get(path: string) {
    return this.docs.get(path);
  }

  _set(path: string, data: DocData) {
    this.docs.set(path, { data: { ...data } });
  }

  count(collection: string) {
    const prefix = `${collection}/`;
    let total = 0;
    for (const key of this.docs.keys()) {
      if (key.startsWith(prefix)) total += 1;
    }
    return total;
  }

  list(collection: string) {
    const prefix = `${collection}/`;
    const rows: DocData[] = [];
    for (const [key, value] of this.docs.entries()) {
      if (key.startsWith(prefix)) rows.push({ ...value.data });
    }
    return rows;
  }

  private cloneDocs() {
    const cloned = new Map<string, StoredDoc>();
    for (const [key, value] of this.docs.entries()) {
      cloned.set(key, { data: { ...value.data } });
    }
    return cloned;
  }
}

class MemoryCollection {
  db: MemoryFirestore;
  name: string;

  constructor(db: MemoryFirestore, name: string) {
    this.db = db;
    this.name = name;
  }

  doc(id?: string) {
    const docId = id ?? randomId();
    return new MemoryDocRef(this.db, this.name, docId);
  }
}

class MemoryDocRef {
  db: MemoryFirestore;
  collectionName: string;
  id: string;

  constructor(db: MemoryFirestore, collectionName: string, id: string) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
  }

  get path() {
    return pathOf(this.collectionName, this.id);
  }

  async get() {
    const stored = this.db._get(this.path);
    return {
      exists: Boolean(stored),
      id: this.id,
      data: () => (stored ? { ...stored.data } : undefined),
    };
  }

  async set(data: DocData) {
    this.db._set(this.path, data);
  }
}

class MemoryTransaction {
  db: MemoryFirestore;
  snapshot: Map<string, StoredDoc>;
  reads = new Map<string, string>();
  ops: TxOp[] = [];

  constructor(db: MemoryFirestore, snapshot: Map<string, StoredDoc>) {
    this.db = db;
    this.snapshot = snapshot;
  }

  async get(ref: MemoryDocRef) {
    const current = this.db._get(ref.path);
    const seen = JSON.stringify(current?.data ?? null);
    const expected = JSON.stringify(this.snapshot.get(ref.path)?.data ?? null);
    if (seen !== expected) {
      throw new Error("transaction_conflict");
    }
    this.reads.set(ref.path, seen);
    const stored = this.snapshot.get(ref.path);
    return {
      exists: Boolean(stored),
      id: ref.id,
      data: () => (stored ? { ...stored.data } : undefined),
    };
  }

  set(ref: MemoryDocRef, data: DocData) {
    this.ops.push({ type: "set", path: ref.path, data: { ...data } });
    this.snapshot.set(ref.path, { data: { ...data } });
  }

  commit() {
    for (const [path, expected] of this.reads.entries()) {
      const current = JSON.stringify(this.db._get(path)?.data ?? null);
      if (current !== expected) {
        throw new Error("transaction_conflict");
      }
    }
    for (const op of this.ops) {
      this.db._set(op.path, op.data);
    }
  }
}

function randomId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 20; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
