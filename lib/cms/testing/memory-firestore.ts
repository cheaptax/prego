import { Timestamp } from "firebase-admin/firestore";

type DocData = Record<string, unknown>;
type StoredDoc = { data: DocData };
type Operation =
  | { type: "set"; path: string; data: DocData }
  | { type: "update"; path: string; data: DocData };

function resolveServerValues(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    value.constructor.name === "ServerTimestampTransform"
  ) {
    return Timestamp.now();
  }
  if (Array.isArray(value)) return value.map(resolveServerValues);
  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Timestamp)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        resolveServerValues(nested),
      ]),
    );
  }
  return value;
}

function resolveData(data: DocData) {
  return resolveServerValues(data) as DocData;
}

function sortable(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value;
}

export class CmsMemoryFirestore {
  private docs = new Map<string, StoredDoc>();
  documentReadCount = 0;
  batchReadCallCount = 0;

  collection(path: string) {
    return new MemoryCollection(this, path);
  }

  async getAll(...refs: MemoryDocRef[]) {
    this.batchReadCallCount += 1;
    return refs.map((ref) => snapshot(this._get(ref.path), ref.id));
  }

  async runTransaction<T>(
    callback: (transaction: MemoryTransaction) => Promise<T>,
  ): Promise<T> {
    const transaction = new MemoryTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }

  _get(path: string) {
    this.documentReadCount += 1;
    return this.docs.get(path);
  }

  _set(path: string, data: DocData) {
    this.docs.set(path, { data: resolveData(data) });
  }

  _update(path: string, data: DocData) {
    const current = this.docs.get(path);
    if (!current) throw new Error(`missing_document:${path}`);
    this.docs.set(path, {
      data: { ...current.data, ...resolveData(data) },
    });
  }

  _query(collectionPath: string, orderField?: string, direction = "asc") {
    const prefix = `${collectionPath}/`;
    const rows = [...this.docs.entries()]
      .filter(([path]) => {
        if (!path.startsWith(prefix)) return false;
        return !path.slice(prefix.length).includes("/");
      })
      .map(([path, stored]) => ({
        id: path.slice(prefix.length),
        data: stored.data,
      }));
    if (orderField) {
      rows.sort((left, right) => {
        const leftValue = sortable(left.data[orderField]);
        const rightValue = sortable(right.data[orderField]);
        const compared =
          leftValue === rightValue ? 0 : leftValue! < rightValue! ? -1 : 1;
        return direction === "desc" ? -compared : compared;
      });
    }
    this.documentReadCount += rows.length;
    return rows;
  }
}

class MemoryCollection {
  private readonly db: CmsMemoryFirestore;
  readonly path: string;
  private readonly orderField?: string;
  private readonly direction: "asc" | "desc";
  private readonly maxResults?: number;

  constructor(
    db: CmsMemoryFirestore,
    path: string,
    orderField?: string,
    direction: "asc" | "desc" = "asc",
    maxResults?: number,
  ) {
    this.db = db;
    this.path = path;
    this.orderField = orderField;
    this.direction = direction;
    this.maxResults = maxResults;
  }

  doc(id: string) {
    return new MemoryDocRef(this.db, `${this.path}/${id}`, id);
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return new MemoryCollection(
      this.db,
      this.path,
      field,
      direction,
      this.maxResults,
    );
  }

  limit(maxResults: number) {
    return new MemoryCollection(
      this.db,
      this.path,
      this.orderField,
      this.direction,
      maxResults,
    );
  }

  async get() {
    const rows = this.db
      ._query(this.path, this.orderField, this.direction)
      .slice(0, this.maxResults);
    return {
      docs: rows.map((row) => ({
        id: row.id,
        exists: true,
        data: () => ({ ...row.data }),
      })),
    };
  }
}

class MemoryDocRef {
  private readonly db: CmsMemoryFirestore;
  readonly path: string;
  readonly id: string;

  constructor(
    db: CmsMemoryFirestore,
    path: string,
    id: string,
  ) {
    this.db = db;
    this.path = path;
    this.id = id;
  }

  collection(name: string) {
    return new MemoryCollection(this.db, `${this.path}/${name}`);
  }

  async get() {
    return snapshot(this.db._get(this.path), this.id);
  }
}

class MemoryTransaction {
  private readonly operations: Operation[] = [];
  private readonly db: CmsMemoryFirestore;

  constructor(db: CmsMemoryFirestore) {
    this.db = db;
  }

  async get(ref: MemoryDocRef) {
    return snapshot(this.db._get(ref.path), ref.id);
  }

  set(ref: MemoryDocRef, data: DocData) {
    this.operations.push({ type: "set", path: ref.path, data });
  }

  update(ref: MemoryDocRef, data: DocData) {
    this.operations.push({ type: "update", path: ref.path, data });
  }

  commit() {
    for (const operation of this.operations) {
      if (operation.type === "set") {
        this.db._set(operation.path, operation.data);
      } else {
        this.db._update(operation.path, operation.data);
      }
    }
  }
}

function snapshot(stored: StoredDoc | undefined, id: string) {
  return {
    id,
    exists: Boolean(stored),
    data: () => (stored ? { ...stored.data } : undefined),
  };
}
