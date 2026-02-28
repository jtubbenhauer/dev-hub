import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { db } from "@/lib/db"
import { users } from "@/drizzle/schema"
import { eq } from "drizzle-orm"
import { compare } from "bcryptjs"
import crypto from "node:crypto"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      username: string
    }
  }

  interface User {
    id: string
    username: string
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      id: "password",
      name: "Password",
      credentials: {
        username: { type: "text" },
        password: { type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null

        const username = credentials.username as string
        const password = credentials.password as string

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))

        if (!user) return null

        const isValid = await compare(password, user.passwordHash)
        if (!isValid) return null

        return { id: user.id, username: user.username }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.username = (user as { username: string }).username
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.id as string
      session.user.username = token.username as string
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex"),
})
