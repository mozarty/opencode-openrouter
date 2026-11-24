// Guards the Bun-only credential path. The TUI runs on Bun, where
// `credentials.ts` reads `bun:sqlite`, while the Node test suite exercises the
// `node:sqlite` driver. This script covers the driver production actually uses.
//
// Run with: bun script/smoke.bun.ts
import { Database } from "bun:sqlite"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveCredential } from "../src/credentials.ts"

const dataHome = mkdtempSync(join(tmpdir(), "openrouter-bun-"))

try {
  mkdirSync(join(dataHome, "opencode"), { recursive: true })
  const database = new Database(join(dataHome, "opencode", "opencode.db"))
  database.run("CREATE TABLE credential (integration_id TEXT, value TEXT, active INTEGER, time_updated INTEGER)")
  database.run("INSERT INTO credential VALUES (?, ?, ?, ?)", [
    "openrouter",
    JSON.stringify({ type: "api", key: "sk-or-bun-smoke" }),
    1,
    Date.now(),
  ])
  database.close()

  const key = await resolveCredential({ env: {}, dataHome })
  if (key !== "sk-or-bun-smoke") {
    throw new Error(`expected the stored key, got ${JSON.stringify(key)}`)
  }

  console.log("bun:sqlite credential path ok")
} finally {
  rmSync(dataHome, { recursive: true, force: true })
}
