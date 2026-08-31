/**
 * Structural declaration of the slice of `@deepseek-ai/dsh-client-ui-primitives`
 * this plugin's browser half requires at runtime. The module is not an npm
 * dependency: the shell's frozen module table ships it to every client bundle
 * (see the harness's `packages/client/web/src/seed.ts`), and the loader's
 * injected `require` answers it — the same official path `react` already takes.
 * Only members actually called are declared, so a shell that adds or changes
 * other exports cannot break this file.
 *
 * This file stays a global script (no top-level imports or exports) so the
 * `declare module` block is an ambient declaration rather than an augmentation
 * of a module TypeScript cannot resolve.
 */

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /**
   * The shell's settled/streaming Markdown renderer. Declared with only the
   * props this plugin passes; the real component accepts more.
   */
  export function MarkdownText(props: {
    readonly text: string
    readonly streaming?: boolean
  }): import('react').ReactNode

  /**
   * Host clipboard write with an execCommand fallback for insecure contexts.
   * @returns true only when the host accepted the write.
   */
  export function writeClipboard(text: string): Promise<boolean>
}
