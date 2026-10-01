import { test, expect } from "claude-code/testing"
import * as reg from "../hooks/register.ts"

const PIN = "4db6139512a61d07f935e0c3b95b6b97f61ab98ed96b2037c40ec9bc27b8b65f"
test("byte-parity RULE_TEXT UTF-8", async () => {
  const bytes = new TextEncoder().encode(reg.RULE_TEXT)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
  expect(sha, "byte-parity: complete UTF-8 literal matches independent pin").toBe(PIN)
  expect((reg as any).RULE_TEXT_SPLICE_SHA256, "byte-parity: module declares the one splice pin").toBe(PIN)
  expect(bytes.length, "byte-parity: UTF-8 byte count, not string length").toBe(824)
})
