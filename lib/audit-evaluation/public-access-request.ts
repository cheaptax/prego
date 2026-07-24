export const AUDIT_EVALUATION_PUBLIC_ACCESS_RESPONSE = {
  ok: true,
  status: "access_instructions_if_eligible",
} as const;

export async function processAuditEvaluationPublicAccessRequest(
  rawBody: string,
  requestAccess: (input: {
    email: string;
    publicReference?: string;
  }) => Promise<unknown>,
) {
  try {
    if (rawBody.length > 4_096) {
      return AUDIT_EVALUATION_PUBLIC_ACCESS_RESPONSE;
    }
    const body = JSON.parse(rawBody) as {
      email?: unknown;
      publicReference?: unknown;
    };
    if (typeof body.email === "string") {
      await requestAccess({
        email: body.email.slice(0, 320),
        publicReference:
          typeof body.publicReference === "string"
            ? body.publicReference.slice(0, 100)
            : undefined,
      });
    }
  } catch {
    // Intentionally hidden from the unauthenticated caller.
  }
  return AUDIT_EVALUATION_PUBLIC_ACCESS_RESPONSE;
}
