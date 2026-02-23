import { randomBytes } from "node:crypto"
import { execSync } from "node:child_process"
import { networkInterfaces } from "node:os"

export interface TmuxSession {
  name: string
  windows: number
  attached: boolean
}

export function getLocalIP(): string {
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    // Prefer en* (macOS WiFi/Ethernet) or bridge* (iPhone USB tethering)
    if (!name.startsWith("en") && !name.startsWith("bridge")) continue
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address
      }
    }
  }
  // Fallback: any non-internal IPv4
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address
      }
    }
  }
  return "127.0.0.1"
}

export function generateToken(): string {
  return randomBytes(16).toString("hex")
}

export function checkTmuxInstalled(): boolean {
  try {
    execSync("which tmux", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function getTmuxSessions(): TmuxSession[] {
  try {
    const output = execSync(
      'tmux list-sessions -F "#{session_name}\t#{session_windows}\t#{session_attached}"',
      { encoding: "utf-8", timeout: 5000 },
    ).trim()
    if (output === "") return []
    return output.split("\n").map((line) => {
      const [name, windows, attached] = line.split("\t")
      return {
        name: name!,
        windows: parseInt(windows!, 10),
        attached: parseInt(attached!, 10) > 0,
      }
    })
  } catch {
    return []
  }
}

export function createTmuxSession(name: string): void {
  execSync(`tmux new-session -d -s ${name} -x 80 -y 24`)
  execSync(`tmux send-keys -t ${name} 'claude' Enter`)
}
