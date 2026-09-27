import { createHash, timingSafeEqual } from "node:crypto";

export function isAuthorizedBearer(
  authorizationHeader: string | undefined,
  expectedToken: string | undefined,
): boolean {
  const prefix = "Bearer ";
  const hasBearer = authorizationHeader?.startsWith(prefix) ?? false;
  const providedToken = authorizationHeader?.startsWith(prefix)
    ? authorizationHeader.slice(prefix.length)
    : "";
  const expectedDigest = createHash("sha256")
    .update(expectedToken ?? "")
    .digest();
  const providedDigest = createHash("sha256").update(providedToken).digest();

  return (
    hasBearer &&
    Boolean(expectedToken) &&
    Boolean(providedToken) &&
    timingSafeEqual(providedDigest, expectedDigest)
  );
}
