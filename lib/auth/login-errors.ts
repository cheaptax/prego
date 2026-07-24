export type LoginErrorMessageKey =
  | "invalidCredentials"
  | "tooManyRequests"
  | "networkError"
  | "genericError";

type FirebaseLikeError = {
  code?: unknown;
};

export function getFirebaseLoginErrorMessageKey(
  error: unknown,
): LoginErrorMessageKey {
  const code =
    error && typeof error === "object"
      ? (error as FirebaseLikeError).code
      : undefined;

  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-email":
      return "invalidCredentials";
    case "auth/too-many-requests":
      return "tooManyRequests";
    case "auth/network-request-failed":
      return "networkError";
    default:
      return "genericError";
  }
}

export function getFirebaseLoginErrorMessage(
  error: unknown,
  messages: Record<LoginErrorMessageKey, string>,
) {
  return messages[getFirebaseLoginErrorMessageKey(error)];
}
