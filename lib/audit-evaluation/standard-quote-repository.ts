import type { Firestore } from "firebase-admin/firestore";
import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { standardQuoteDocumentRecordSchema } from "@/lib/audit-evaluation/quote-document-schemas";
import type { StandardQuoteDocumentRecord } from "@/lib/audit-evaluation/types";
import { adminDb } from "@/lib/firebase/admin";

export interface StandardQuoteDocumentRepository {
  create(
    value: StandardQuoteDocumentRecord,
  ): Promise<StandardQuoteDocumentRecord>;
  get(
    quoteDocumentId: string,
  ): Promise<StandardQuoteDocumentRecord | null>;
  findExistingMatchedUpload(
    caseId: string,
    quoteDocumentId: string,
    excludingUploadDocumentId: string,
  ): Promise<string | null>;
}

export class FirestoreStandardQuoteDocumentRepository
  implements StandardQuoteDocumentRepository
{
  private readonly db: Firestore;

  constructor(db: Firestore = adminDb()) {
    this.db = db;
  }

  async create(value: StandardQuoteDocumentRecord) {
    const parsed = standardQuoteDocumentRecordSchema.parse(value);
    await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.standardQuoteDocuments)
      .doc(parsed.quoteDocumentId)
      .create(parsed);
    return parsed;
  }

  async get(quoteDocumentId: string) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.standardQuoteDocuments)
      .doc(quoteDocumentId)
      .get();
    if (!snapshot.exists) return null;
    return standardQuoteDocumentRecordSchema.parse(snapshot.data());
  }

  async findExistingMatchedUpload(
    caseId: string,
    quoteDocumentId: string,
    excludingUploadDocumentId: string,
  ) {
    const snapshot = await this.db
      .collection(AUDIT_EVALUATION_COLLECTIONS.documents)
      .where("caseId", "==", caseId)
      .where("matchedQuoteDocumentId", "==", quoteDocumentId)
      .limit(2)
      .get();
    const match = snapshot.docs.find(
      (document) =>
        document.id !== excludingUploadDocumentId &&
        document.data().uploadStatus !== "DELETED",
    );
    return match?.id ?? null;
  }
}
