import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server"
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server/script/deps"
import { db } from "@/lib/db"
import { passkeys } from "@/drizzle/schema"
import { eq } from "drizzle-orm"

const RP_NAME = "Dev Hub"
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost"
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:3000"

// In-memory challenge store (scoped to server process lifetime)
const challengeStore = new Map<string, string>()

export async function generatePasskeyRegistrationOptions(
  userId: string,
  username: string
) {
  const userPasskeys = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, userId))

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: username,
    attestationType: "none",
    excludeCredentials: userPasskeys.map((pk) => ({
      id: pk.id,
      transports: pk.transports
        ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  })

  challengeStore.set(userId, options.challenge)
  return options
}

export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON
): Promise<VerifiedRegistrationResponse | null> {
  const expectedChallenge = challengeStore.get(userId)
  if (!expectedChallenge) return null

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo

      await db.insert(passkeys).values({
        id: credential.id,
        userId,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        deviceType: verification.registrationInfo.credentialDeviceType,
        transports: response.response.transports
          ? JSON.stringify(response.response.transports)
          : null,
      })
    }

    challengeStore.delete(userId)
    return verification
  } catch {
    challengeStore.delete(userId)
    return null
  }
}

export async function generatePasskeyAuthenticationOptions() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  })

  challengeStore.set("auth", options.challenge)
  return options
}

export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON
): Promise<{ userId: string } | null> {
  const expectedChallenge = challengeStore.get("auth")
  if (!expectedChallenge) return null

  const [passkey] = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.id, response.id))

  if (!passkey) return null

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports
          ? (JSON.parse(passkey.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
    })

    if (verification.verified) {
      await db
        .update(passkeys)
        .set({ counter: verification.authenticationInfo.newCounter })
        .where(eq(passkeys.id, response.id))

      challengeStore.delete("auth")
      return { userId: passkey.userId }
    }

    return null
  } catch {
    challengeStore.delete("auth")
    return null
  }
}

export async function getUserPasskeys(userId: string) {
  return db.select().from(passkeys).where(eq(passkeys.userId, userId))
}
