import { describe, it, expect } from "vitest"
import {
  getLocalIP,
  generateToken,
  checkTmuxInstalled,
  getTmuxSessions,
} from "../utils.ts"

describe("generateToken", () => {
  it("returns a 32-character hex string", () => {
    const token = generateToken()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    expect(tokens.size).toBe(100)
  })
})

describe("getLocalIP", () => {
  it("returns a valid IPv4 address", () => {
    const ip = getLocalIP()
    expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
  })
})

describe("checkTmuxInstalled", () => {
  it("returns a boolean", () => {
    const result = checkTmuxInstalled()
    expect(typeof result).toBe("boolean")
  })
})

describe("getTmuxSessions", () => {
  it("returns an array", () => {
    const sessions = getTmuxSessions()
    expect(Array.isArray(sessions)).toBe(true)
  })

  it("session objects have required fields", () => {
    const sessions = getTmuxSessions()
    for (const session of sessions) {
      expect(session).toHaveProperty("name")
      expect(session).toHaveProperty("windows")
      expect(session).toHaveProperty("attached")
      expect(typeof session.name).toBe("string")
      expect(typeof session.windows).toBe("number")
      expect(typeof session.attached).toBe("boolean")
    }
  })
})
