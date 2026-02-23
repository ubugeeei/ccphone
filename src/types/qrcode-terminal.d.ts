declare module "qrcode-terminal" {
  function generate(text: string, opts?: { small?: boolean }): void
  function generate(
    text: string,
    opts: { small?: boolean } | undefined,
    cb: (qrcode: string) => void,
  ): void
  export default { generate }
}
