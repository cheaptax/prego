import { isActiveMember } from "@/lib/member-status";

export type FirebaseCustomerAccessIdentity = {
  uid: string;
  email?: string;
  email_verified?: boolean;
  admin?: boolean;
};

export function canUseFirebaseCustomerEvaluationAccess(
  identity: FirebaseCustomerAccessIdentity,
  memberStatus?: string,
): identity is FirebaseCustomerAccessIdentity & {
  email: string;
  email_verified: true;
} {
  return (
    identity.admin !== true &&
    identity.email_verified === true &&
    typeof identity.email === "string" &&
    identity.email.trim().length > 0 &&
    isActiveMember(memberStatus)
  );
}
