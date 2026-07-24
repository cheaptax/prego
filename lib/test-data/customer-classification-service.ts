import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  classifyCustomerDataRecord,
  TEST_CUSTOMER_EMAILS,
  type CustomerDataClassification,
} from "@/lib/test-data/email-classification";

export type CustomerClassificationItem = {
  uid: string;
  name: string;
  email: string;
  cooperativeName: string;
  classification: CustomerDataClassification;
  firestoreStatus: "CONNECTED" | "AUTH_ONLY";
  createdAt: string;
};

export type CustomerClassificationSummary = {
  production: number;
  test: number;
  unsupported: number;
  total: number;
};

export class CustomerClassificationService {
  constructor(
    private readonly db: Firestore = adminDb(),
    private readonly auth: Auth = adminAuth(),
  ) {}

  async list(limit = 1_000): Promise<{
    items: CustomerClassificationItem[];
    summary: CustomerClassificationSummary;
    allowedTestEmails: readonly string[];
  }> {
    const safeLimit = Math.min(Math.max(limit, 1), 1_000);
    const [userSnapshot, authResult] = await Promise.all([
      this.db.collection("users").limit(safeLimit).get(),
      this.auth.listUsers(safeLimit),
    ]);
    const firestoreUsers = new Map(
      userSnapshot.docs.map((document) => [document.id, document.data()]),
    );
    const items = authResult.users
      .filter((authUser) => {
        const role = firestoreUsers.get(authUser.uid)?.role;
        return role === "member" || (!role && Boolean(authUser.email));
      })
      .map((authUser): CustomerClassificationItem => {
        const profile = firestoreUsers.get(authUser.uid);
        const email = String(profile?.email ?? authUser.email ?? "")
          .trim()
          .toLowerCase();
        return {
          uid: authUser.uid,
          name: String(profile?.name ?? authUser.displayName ?? ""),
          email,
          cooperativeName: String(profile?.cooperativeName ?? ""),
              classification: classifyCustomerDataRecord({
                email,
                dataClassification: profile?.dataClassification,
                cooperativeId: profile?.cooperativeId,
                nh_org_id: profile?.nh_org_id,
                sourceInstitutionId: profile?.sourceInstitutionId,
              }),
          firestoreStatus: profile ? "CONNECTED" : "AUTH_ONLY",
          createdAt: String(
            profile?.createdAt ?? authUser.metadata.creationTime ?? "",
          ),
        };
      })
      .sort((left, right) => {
        const classificationOrder = {
          TEST: 0,
          UNSUPPORTED: 1,
          PRODUCTION: 2,
        } as const;
        return (
          classificationOrder[left.classification] -
            classificationOrder[right.classification] ||
          right.createdAt.localeCompare(left.createdAt)
        );
      });
    const summary = items.reduce<CustomerClassificationSummary>(
      (counts, item) => {
        counts.total += 1;
        if (item.classification === "PRODUCTION") counts.production += 1;
        if (item.classification === "TEST") counts.test += 1;
        if (item.classification === "UNSUPPORTED") counts.unsupported += 1;
        return counts;
      },
      { production: 0, test: 0, unsupported: 0, total: 0 },
    );
    return {
      items,
      summary,
      allowedTestEmails: TEST_CUSTOMER_EMAILS,
    };
  }
}
