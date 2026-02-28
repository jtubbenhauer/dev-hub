import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"
import { getOrStartServer } from "./server-pool"

let clientInstance: OpencodeClient | null = null
let clientBaseUrl: string | null = null

export async function getOpenCodeClient(): Promise<OpencodeClient> {
  const { url } = await getOrStartServer()

  if (clientInstance && clientBaseUrl === url) {
    return clientInstance
  }

  clientInstance = createOpencodeClient({
    baseUrl: url,
  })
  clientBaseUrl = url

  return clientInstance
}

export async function getServerUrl(): Promise<string> {
  const { url } = await getOrStartServer()
  return url
}

export function resetClient() {
  clientInstance = null
  clientBaseUrl = null
}
