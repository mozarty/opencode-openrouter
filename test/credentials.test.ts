import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, it } from "node:test"

import { resolveCredential } from "../src/credentials.ts"

function withDataHome(run: (dataHome: string) => Promise<void>) {
  const dataHome = mkdtempSync(join(tmpdir(), "openrouter-credential-"))
  return run(dataHome).finally(() => rmSync(dataHome, { recursive: true, force: true }))
}

// Mirrors the row OpenCode writes for an integration credential.
function seedCredential(dataHome: string, value: string): void {
  mkdirSync(join(dataHome, "opencode"), { recursive: true })
  const database = new DatabaseSync(join(dataHome, "opencode", "opencode.db"))
  try {
    database.exec("CREATE TABLE credential (integration_id TEXT, value TEXT, active INTEGER, time_updated INTEGER)")
    database
      .prepare("INSERT INTO credential (integration_id, value, active, time_updated) VALUES (?, ?, ?, ?)")
      .run("openrouter", value, 1, Date.now())
  } finally {
    database.close()
  }
}

function seedAuthFile(dataHome: string, key: string): void {
  mkdirSync(join(dataHome, "opencode"), { recursive: true })
  writeFileSync(join(dataHome, "opencode", "auth.json"), JSON.stringify({ openrouter: { type: "api", key } }))
}

describe("resolveCredential", () => {
  it("prefers the environment variable", async () => {
    await withDataHome(async (dataHome) => {
      seedCredential(dataHome, JSON.stringify({ key: "from-store" }))
      assert.equal(await resolveCredential({ env: { OPENROUTER_API_KEY: "  from-env  " }, dataHome }), "from-env")
    })
  })

  it("reports no key when nothing is configured", async () => {
    await withDataHome(async (dataHome) => {
      assert.equal(await resolveCredential({ env: {}, dataHome }), null)
    })
  })

  it("reads a key from the credential store", async () => {
    await withDataHome(async (dataHome) => {
      seedCredential(dataHome, JSON.stringify({ key: "sk-or-store" }))
      assert.equal(await resolveCredential({ env: {}, dataHome }), "sk-or-store")
    })
  })

  it("never returns a structured OAuth blob as a bearer token", async () => {
    await withDataHome(async (dataHome) => {
      seedCredential(dataHome, JSON.stringify({ type: "oauth", access: "at-123", refresh: "rt-456" }))
      assert.equal(await resolveCredential({ env: {}, dataHome }), null)
    })
  })

  it("falls back to the legacy auth file", async () => {
    await withDataHome(async (dataHome) => {
      seedAuthFile(dataHome, "sk-or-file")
      assert.equal(await resolveCredential({ env: {}, dataHome }), "sk-or-file")
    })
  })

  it("prefers the credential store over the legacy auth file", async () => {
    await withDataHome(async (dataHome) => {
      seedCredential(dataHome, JSON.stringify({ key: "sk-or-store" }))
      seedAuthFile(dataHome, "sk-or-file")
      assert.equal(await resolveCredential({ env: {}, dataHome }), "sk-or-store")
    })
  })
})
