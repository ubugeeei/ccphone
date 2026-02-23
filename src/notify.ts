const ESC = String.fromCharCode(0x1b)
const CSI = String.fromCharCode(0x9b)
const ANSI_RE = new RegExp(
  `[${ESC}${CSI}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]`,
  "g",
)

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "")
}

const INPUT_PATTERNS: RegExp[] = [
  /\?\s*$/m, // line ending with ?
  /\[[Yy]\/[Nn]\]/, // [Y/n] or [y/N]
  /\[[Yy][Nn]\]/, // [YN] or [yn]
  />\s*$/m, // line ending with >
  /❯\s*$/m, // interactive selector
]

const IDLE_MS = 3000

export function createInputDetector(
  onNotify: (hint: string) => void,
): {
  feed(data: string): void
  dispose(): void
} {
  let buffer = ""
  let timer: ReturnType<typeof setTimeout> | null = null

  function check(): void {
    const clean = stripAnsi(buffer)
    // Only look at the last few lines
    const tail = clean.slice(-500)

    for (const pattern of INPUT_PATTERNS) {
      if (pattern.test(tail)) {
        onNotify("Claude is waiting for input")
        buffer = ""
        return
      }
    }

    buffer = ""
  }

  function feed(data: string): void {
    buffer += data

    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      check()
    }, IDLE_MS)
  }

  function dispose(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    buffer = ""
  }

  return { feed, dispose }
}
