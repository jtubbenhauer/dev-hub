"use client"

import { useState, useEffect } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Terminal, LogIn, UserPlus } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((res) => res.json())
      .then((data) => setNeedsSetup(data.needsSetup))
      .catch(() => setNeedsSetup(false))
  }, [])

  if (needsSetup === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (needsSetup) {
    return <SetupForm onComplete={() => router.push("/")} />
  }

  return <LoginForm />
}

function LoginForm() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setError("")
    setLoading(true)
    try {
      const result = await signIn("password", {
        username,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError("Invalid username or password")
      } else {
        router.push("/")
      }
    } catch {
      setError("Authentication failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Terminal className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Dev Hub</CardTitle>
          <CardDescription>Sign in to your development hub</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  document.getElementById("password")?.focus()
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && username && password) handleLogin()
              }}
            />
          </div>
          <Button
            onClick={handleLogin}
            disabled={loading || !username || !password}
            className="w-full"
            size="lg"
          >
            <LogIn className="mr-2 h-4 w-4" />
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function SetupForm({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSetup() {
    setError("")

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-user", username, password }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to create account")
        return
      }

      // Auto-login after setup
      const result = await signIn("password", {
        username,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError("Account created but auto-login failed. Please sign in.")
        return
      }

      onComplete()
    } catch {
      setError("Failed to create account")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Terminal className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Setup Dev Hub</CardTitle>
          <CardDescription>Create your account to get started</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="setup-username">Username</Label>
            <Input
              id="setup-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              autoComplete="username"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  document.getElementById("setup-password")?.focus()
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-password">Password</Label>
            <Input
              id="setup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  document.getElementById("setup-confirm-password")?.focus()
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-confirm-password">Confirm Password</Label>
            <Input
              id="setup-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              autoComplete="new-password"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  username &&
                  password &&
                  confirmPassword
                ) {
                  handleSetup()
                }
              }}
            />
          </div>
          <Button
            onClick={handleSetup}
            disabled={loading || !username || !password || !confirmPassword}
            className="w-full"
            size="lg"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
