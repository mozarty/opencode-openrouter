// Resolves the active OpenRouter API key for the configured integration.
//
// Order: explicit environment variable, OpenCode's credential store, then the
// legacy auth.json. The environment variable exists because OpenCode does not
// expose credential secrets through its plugin API, only connection metadata.
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"

export const ENV_API_KEY = "OPENROUTER_API_KEY"
export const INTEGRATION_ID = "openrouter"

type ResolveOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly dataHome?: string
}

type Database = {
  prepare: (sql: string) => { get: (id: string) => unknown }
  close: () => void
}

// Switching keys deactivates the old row and inserts the new one in the same
// millisecond, so ordering by time_updated alone is ambiguous.
const CREDENTIAL_QUERY =
  "SELECT value FROM credential WHERE integration_id = ? ORDER BY active DESC, time_updated DESC, rowid DESC LIMIT 1"

const requireModule = createRequire(import.meta.url)

function defaultDataHome(): string {
  return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function readSecret(value: unknown): string | null {
  if (typeof value === "string" && value) return value
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  for (const field of ["key", "apiKey", "token"]) {
    const candidate = record[field]
    if (typeof candidate === "string" && candidate) return candidate
  }
  return null
}

function openDatabase(path: string): Database {
  if ("Bun" in globalThis) {
    const { Database: BunDatabase } = requireModule("bun:sqlite")
    return new BunDatabase(path, { readonly: true })
  }
  const { DatabaseSync } = requireModule("node:sqlite")
  return new DatabaseSync(path, { readOnly: true })
}

// Reads the secret straight from OpenCode's SQLite store. This is an internal
// schema, so every failure mode (missing table, missing driver, locked file)
// degrades to "no key" instead of throwing into the widget.
function keyFromCredentialStore(dataHome: string): string | null {
  const path = join(dataHome, "opencode", "opencode.db")
  if (!existsSync(path)) return null

  let database: Database | null = null
  try {
    database = openDatabase(path)
    const row = database.prepare(CREDENTIAL_QUERY).get(INTEGRATION_ID) as { value?: unknown } | undefined
    if (!row) return null

    // `value` is normally a JSON blob. A bare string is only accepted when the
    // row is not structured, so an OAuth blob is never sent as a bearer token.
    const parsed = safeJson(row.value)
    return readSecret(parsed) ?? (parsed === null ? readSecret(row.value) : null)
  } catch {
    return null
  } finally {
    try {
      database?.close()
    } catch {}
  }
}

async function keyFromAuthFile(dataHome: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dataHome, "opencode", "auth.json"), "utf-8")
    const auth = JSON.parse(raw) as Record<string, unknown> | null
    return readSecret(auth?.[INTEGRATION_ID])
  } catch {
    return null
  }
}

export async function resolveCredential(options: ResolveOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env
  const dataHome = options.dataHome ?? defaultDataHome()

  const fromEnv = env[ENV_API_KEY]
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim()

  return keyFromCredentialStore(dataHome) ?? (await keyFromAuthFile(dataHome))
}
