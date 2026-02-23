#!/usr/bin/env node

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { WebSocketServer, type WebSocket } from "ws"
import * as pty from "node-pty"
import qrcode from "qrcode-terminal"
import {
  getLocalIP,
  generateToken,
  checkTmuxInstalled,
  getTmuxSessions,
  createTmuxSession,
  type TmuxSession,
} from "./utils.ts"
import { createInputDetector } from "./notify.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.CC_PHONE_PORT || "7777", 10)
const TOKEN = generateToken()

interface ClientInfo {
  cols: number
  rows: number
}

// --- Interactive session selection ---

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function selectSession(): Promise<string> {
  if (!checkTmuxInstalled()) {
    console.error("Error: tmux is not installed.")
    console.error("  Install with: brew install tmux")
    process.exit(1)
  }

  const sessions = getTmuxSessions()

  if (sessions.length === 0) {
    console.log("No tmux sessions found.")
    const answer = await promptUser(
      "Create a new session and launch claude? [Y/n] ",
    )
    if (answer.toLowerCase() === "n") {
      console.log("No session to attach to. Exiting.")
      process.exit(0)
    }
    const name = "claude"
    console.log(`Creating session "${name}" and launching claude...`)
    createTmuxSession(name)
    return name
  }

  if (sessions.length === 1) {
    const session = sessions[0]!
    console.log(`Attaching to session: ${session.name}`)
    return session.name
  }

  console.log("Available tmux sessions:")
  sessions.forEach((s: TmuxSession, i: number) => {
    const attached = s.attached ? " *attached*" : ""
    console.log(
      `  [${i + 1}] ${s.name} (${s.windows} window${
        s.windows > 1 ? "s" : ""
      })${attached}`,
    )
  })

  const answer = await promptUser(`Select session [1-${sessions.length}]: `)
  const idx = parseInt(answer, 10) - 1
  if (isNaN(idx) || idx < 0 || idx >= sessions.length) {
    console.error("Invalid selection. Exiting.")
    process.exit(1)
  }

  return sessions[idx]!.name
}

// --- Server ---

async function main(): Promise<void> {
  console.log("ccphone v0.1.0\n")

  // CLI argument: session name
  const argSession = process.argv[2]
  let sessionName = argSession || (await selectSession())

  // Resolve HTML path (works in both dev and built mode)
  let htmlContent: string
  try {
    // Try built path first (dist/public/index.html)
    htmlContent = readFileSync(join(__dirname, "public", "index.html"), "utf-8")
  } catch {
    // Fall back to project root public/
    htmlContent = readFileSync(
      join(__dirname, "..", "public", "index.html"),
      "utf-8",
    )
  }

  // HTTP server
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`)
    const pathToken = url.pathname.slice(1) // Remove leading /

    if (pathToken !== TOKEN) {
      res.writeHead(403, { "Content-Type": "text/plain" })
      res.end("Forbidden")
      return
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    })
    res.end(htmlContent)
  })

  // WebSocket server (noServer for manual auth)
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Map<WebSocket, ClientInfo>()
  let ptyProcess: pty.IPty | null = null
  let notified = false
  let switching = false

  const inputDetector = createInputDetector((hint: string) => {
    if (notified) return
    notified = true
    const msg = JSON.stringify({ type: "notify", hint })
    for (const client of clients.keys()) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  function spawnPty(name: string, cols: number, rows: number): void {
    ptyProcess = pty.spawn("tmux", ["attach-session", "-t", name], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME || "/",
      env: {
        ...process.env,
        TERM: "xterm-256color",
      } as Record<string, string>,
    })

    ptyProcess.onData((data: string) => {
      inputDetector.feed(data)
      for (const client of clients.keys()) {
        if (client.readyState === 1) {
          client.send(data)
        }
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (switching) {
        switching = false
        return
      }
      console.log(`\nSession ended (exit code: ${exitCode}).`)
      for (const client of clients.keys()) {
        client.close()
      }
      ptyProcess = null
      server.close()
      process.exit(0)
    })
  }

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`)
    const pathToken = url.pathname.replace(/^\/ws\//, "")

    if (pathToken !== TOKEN) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws)
    })
  })

  wss.on("connection", (ws: WebSocket) => {
    clients.set(ws, { cols: 80, rows: 24 })
    console.log(`Client connected (total: ${clients.size})`)

    // Spawn pty on first connection
    if (!ptyProcess) {
      const firstClient = clients.get(ws)!
      spawnPty(sessionName, firstClient.cols, firstClient.rows)
    }

    ws.on("message", (raw) => {
      if (!ptyProcess) return
      const str =
        raw instanceof Buffer
          ? raw.toString("utf-8")
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw).toString("utf-8")
            : Buffer.concat(raw as Buffer[]).toString("utf-8")
      try {
        const msg = JSON.parse(str)
        switch (msg.type) {
          case "input":
            notified = false
            ptyProcess.write(msg.data)
            break
          case "resize":
            if (msg.cols > 0 && msg.rows > 0) {
              clients.set(ws, {
                cols: Math.min(msg.cols, 500),
                rows: Math.min(msg.rows, 200),
              })
              ptyProcess.resize(
                Math.min(msg.cols, 500),
                Math.min(msg.rows, 200),
              )
            }
            break
          case "list-sessions": {
            const sessions = getTmuxSessions()
            ws.send(
              JSON.stringify({
                type: "sessions",
                sessions: sessions.map((s) => ({
                  name: s.name,
                  windows: s.windows,
                  attached: s.attached,
                })),
                current: sessionName,
              }),
            )
            break
          }
          case "switch-session": {
            const targetName = msg.name
            if (!targetName || targetName === sessionName) break
            console.log(`Switching session: ${sessionName} → ${targetName}`)
            switching = true
            inputDetector.dispose()
            if (ptyProcess) {
              ptyProcess.kill()
              ptyProcess = null
            }
            sessionName = targetName
            const dims = clients.get(ws) || { cols: 80, rows: 24 }
            spawnPty(sessionName, dims.cols, dims.rows)
            const switchedMsg = JSON.stringify({
              type: "switched",
              name: sessionName,
            })
            for (const client of clients.keys()) {
              if (client.readyState === 1) {
                client.send(switchedMsg)
              }
            }
            break
          }
          case "ping":
            ws.send(JSON.stringify({ type: "pong" }))
            break
        }
      } catch {
        // Not JSON - treat as raw input
        ptyProcess.write(str)
      }
    })

    ws.on("close", () => {
      clients.delete(ws)
      console.log(`Client disconnected (total: ${clients.size})`)

      // Resize to remaining client's dimensions
      if (clients.size === 1 && ptyProcess) {
        const [, dims] = clients.entries().next()
          .value as [WebSocket, ClientInfo]
        ptyProcess.resize(dims.cols, dims.rows)
      }
    })
  })

  // Start server with port retry
  let port = PORT
  const maxRetries = 3

  for (let i = 0; i <= maxRetries; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            reject(err)
          } else {
            reject(err)
          }
        })
        server.listen(port, "0.0.0.0", () => resolve())
      })
      break
    } catch {
      if (i < maxRetries) {
        port++
        console.log(`Port ${port - 1} in use, trying ${port}...`)
      } else {
        console.error(
          `Error: Could not find an available port (tried ${PORT}-${port}).`,
        )
        process.exit(1)
      }
    }
  }

  const ip = getLocalIP()
  const url = `http://${ip}:${port}/${TOKEN}`

  console.log(`\nServer running on port ${port}`)
  console.log(`Local URL: ${url}\n`)
  console.log("Scan this QR code on your iPhone:\n")
  qrcode.generate(url, { small: true })
  console.log("\nWaiting for connections... (Ctrl+C to quit)")

  // Graceful shutdown
  function cleanup(): void {
    console.log("\nShutting down...")
    inputDetector.dispose()
    for (const client of wss.clients) {
      client.close()
    }
    if (ptyProcess) {
      ptyProcess.kill()
      ptyProcess = null
    }
    server.close()
    process.exit(0)
  }

  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
