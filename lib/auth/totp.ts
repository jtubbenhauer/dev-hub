import { TOTP, generateSecret } from "otplib"
import { db } from "@/lib/db"
import { totpSecrets } from "@/drizzle/schema"
import { eq } from "drizzle-orm"

const totp = new TOTP()

export function generateTOTPSecret(): string {
  return generateSecret()
}

export function generateTOTPUri(secret: string, username: string): string {
  return totp.keyuri(username, "Dev Hub", secret)
}

export function verifyTOTPToken(secret: string, token: string): boolean {
  return totp.verify({ token, secret })
}

export async function setupTOTP(
  userId: string,
  secret: string
): Promise<void> {
  await db
    .insert(totpSecrets)
    .values({ userId, secret, verified: false })
    .onConflictDoUpdate({
      target: totpSecrets.userId,
      set: { secret, verified: false },
    })
}

export async function verifyAndActivateTOTP(
  userId: string,
  token: string
): Promise<boolean> {
  const [record] = await db
    .select()
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, userId))

  if (!record) return false

  const isValid = verifyTOTPToken(record.secret, token)
  if (isValid && !record.verified) {
    await db
      .update(totpSecrets)
      .set({ verified: true })
      .where(eq(totpSecrets.userId, userId))
  }
  return isValid
}

export async function verifyTOTP(
  userId: string,
  token: string
): Promise<boolean> {
  const [record] = await db
    .select()
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, userId))

  if (!record || !record.verified) return false
  return verifyTOTPToken(record.secret, token)
}
