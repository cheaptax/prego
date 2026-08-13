import type { Firestore } from "firebase-admin/firestore";
import { adminAuth } from "@/lib/firebase/admin";
import { getAccountStatus } from "@/lib/admin/rbac";
import { shouldEnablePartnerAccount } from "@/lib/partner-management";
import type {
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export async function loadPartnerAccounts(
  db: Firestore,
  partnerId: string,
) {
  const snapshot = await db
    .collection("users")
    .where("partnerId", "==", partnerId)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as UserRecord)
    .filter(
      (user) =>
        user.role === "partner" ||
        (user.multiRoleTestAccount === true &&
          Boolean(user.partnerId) &&
          (user.enabledPortals?.includes("partner") ?? false)),
    )
    .sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? "").localeCompare(
        left.updatedAt ?? left.createdAt ?? "",
      ),
    );
}

export async function loadPartnerRelationData(
  db: Firestore,
  partnerId: string,
) {
  const [accounts, assignmentSnapshot, draftSnapshot, answerSnapshot] =
    await Promise.all([
      loadPartnerAccounts(db, partnerId),
      db
        .collection("partnerAssignments")
        .where("partnerId", "==", partnerId)
        .get(),
      db
        .collection("partnerAnswerDrafts")
        .where("partnerId", "==", partnerId)
        .get(),
      db.collection("answers").where("partnerId", "==", partnerId).get(),
    ]);
  const assignments = assignmentSnapshot.docs.map(
    (doc) => doc.data() as PartnerAssignmentRecord,
  );
  const drafts = draftSnapshot.docs.map(
    (doc) => doc.data() as PartnerAnswerDraftRecord,
  );
  return {
    accounts,
    assignments,
    drafts,
    summary: {
      memberCount: accounts.length,
      assignmentCount: assignments.length,
      activeAssignmentCount: assignments.filter(
        (assignment) => assignment.status !== "revoked",
      ).length,
      draftCount: drafts.length,
      answerCount: answerSnapshot.size,
    },
  };
}

export async function syncPartnerAccountAccess(
  accounts: UserRecord[],
  partner: Pick<PartnerRecord, "id" | "status">,
) {
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const authUser = await adminAuth().getUser(account.uid);
        const enabled = shouldEnablePartnerAccount(
          partner.status,
          getAccountStatus(account),
        );
        if (!account.multiRoleTestAccount) {
          await adminAuth().updateUser(account.uid, { disabled: !enabled });
        }
        await adminAuth().setCustomUserClaims(account.uid, {
          ...(authUser.customClaims ?? {}),
          partner: enabled,
          partnerId: partner.id,
          ...(account.multiRoleTestAccount ? { multiRole: true } : {}),
        });
        return { uid: account.uid, ok: true as const };
      } catch {
        return { uid: account.uid, ok: false as const };
      }
    }),
  );
  return {
    updated: results.filter((result) => result.ok).length,
    failedUids: results
      .filter((result) => !result.ok)
      .map((result) => result.uid),
  };
}
