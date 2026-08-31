/**
 * Standalone replica of the harness's internal `clientBundle` tsdown preset
 * (`packages/client/tsdown.client.ts`, unpublished). Two artifacts:
 *
 * - `lib/index.js` — the node half the host Loader imports (plain ESM).
 * - `lib/client.js` — the browser half, a closure factory the web shell's
 *   module loader executes as `window.__ModuleLoader__.load({ id, factory })`.
 *   Externals are answered by the loader's frozen module table through the
 *   injected `require`; anything else must be inlined.
 *
 * This plugin imports no `@deepseek-ai/*` package: every host and client
 * service it touches is typed structurally, so `react` is the only shared
 * runtime it needs from the table, and styles ride one injected <style> tag
 * instead of a CSS pipeline.
 */
import { defineConfig } from 'tsdown'

/** Plugin id: MUST equal the package name — the loader keys the module table by it. */
const ID = 'dsh-mvp-factory'

/**
 * The shell's frozen module table entries this bundle resolves at runtime.
 * `ui-primitives` is the shell's shared component library (MarkdownText,
 * writeClipboard); everything else must be inlined.
 */
const EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const MODE = process.env.NODE_ENV ?? 'production'

export default defineConfig([
  {
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...EXTERNALS],
    // Everything outside the module table inlines; the table IS the rule.
    noExternal: (id: string) => (EXTERNALS.includes(id) ? undefined : true),
    // A CJS browser output carries no `import.meta`, and bundled deps may read
    // both keys. Without these the factory can throw at boot.
    define: {
      'process.env.NODE_ENV': JSON.stringify(MODE),
      'import.meta.env.MODE': JSON.stringify(MODE),
      'import.meta.env': JSON.stringify({ MODE }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
    },
  },
])
