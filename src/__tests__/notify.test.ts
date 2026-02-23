import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { stripAnsi, createInputDetector } from "../notify.ts"

describe("stripAnsi", () => {
  it("removes basic escape sequences", () => {
    expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello")
  })

  it("removes cursor movement sequences", () => {
    expect(stripAnsi("\x1b[2Jfoo\x1b[H")).toBe("foo")
  })

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world")
  })

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("")
  })

  it("removes multiple sequences", () => {
    expect(stripAnsi("\x1b[1m\x1b[32mbold green\x1b[0m")).toBe("bold green")
  })
})

describe("createInputDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("detects line ending with ?", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Do you want to proceed?")
    vi.advanceTimersByTime(3000)

    expect(onNotify).toHaveBeenCalledWith("Claude is waiting for input")
    detector.dispose()
  })

  it("detects [Y/n] prompt", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Continue? [Y/n] ")
    vi.advanceTimersByTime(3000)

    expect(onNotify).toHaveBeenCalledWith("Claude is waiting for input")
    detector.dispose()
  })

  it("detects [y/N] prompt", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Are you sure? [y/N] ")
    vi.advanceTimersByTime(3000)

    expect(onNotify).toHaveBeenCalledWith("Claude is waiting for input")
    detector.dispose()
  })

  it("detects line ending with >", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Enter your message >")
    vi.advanceTimersByTime(3000)

    expect(onNotify).toHaveBeenCalledWith("Claude is waiting for input")
    detector.dispose()
  })

  it("detects interactive selector", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Select an option\n❯")
    vi.advanceTimersByTime(3000)

    expect(onNotify).toHaveBeenCalledWith("Claude is waiting for input")
    detector.dispose()
  })

  it("does not fire before idle timeout", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Do you want to proceed?")
    vi.advanceTimersByTime(2000)

    expect(onNotify).not.toHaveBeenCalled()
    detector.dispose()
  })

  it("resets timer on new data", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Some output")
    vi.advanceTimersByTime(2000)
    detector.feed(" more output?")
    vi.advanceTimersByTime(2000)

    expect(onNotify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(onNotify).toHaveBeenCalledTimes(1)
    detector.dispose()
  })

  it("does not fire for non-matching output", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Building project...\nDone.")
    vi.advanceTimersByTime(3000)

    expect(onNotify).not.toHaveBeenCalled()
    detector.dispose()
  })

  it("strips ANSI before matching", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("\x1b[1m\x1b[33mContinue?\x1b[0m")
    vi.advanceTimersByTime(3000)

    expect(onNotify).toHaveBeenCalledWith("Claude is waiting for input")
    detector.dispose()
  })

  it("dispose cancels pending timer", () => {
    const onNotify = vi.fn()
    const detector = createInputDetector(onNotify)

    detector.feed("Continue?")
    detector.dispose()
    vi.advanceTimersByTime(3000)

    expect(onNotify).not.toHaveBeenCalled()
  })
})
