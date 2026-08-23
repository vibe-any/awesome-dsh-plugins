/**
 * dsh-plugin-playwithai-hub build script.
 *
 * Both halves are bundled with esbuild so no relative source layout leaks
 * into lib/:
 *
 * - Host half (src/index.js): bundled ESM, platform node → lib/index.js.
 * - Client half (src/client/index.jsx): bundled CJS wrapped in the DSH
 *   client-modules handshake → lib/client.js:
 *
 *     window.__ModuleLoader__.load({ id, factory })
 *
 * `react` stays external on the client: the web shell seeds it in the module
 * table, and the loader-provided require resolves it inside the factory. JSX
 * uses the classic transform so react is the only external request.
 */

import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const id = pkg.name

await mkdir(new URL('./lib/', import.meta.url), { recursive: true })

// --- host half: self-contained ESM bundle ----------------------------------
await build({
  entryPoints: [new URL('./src/index.js', import.meta.url).pathname],
  outfile: new URL('./lib/index.js', import.meta.url).pathname,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  legalComments: 'inline',
  sourcemap: 'external',
  minify: false,
})

// --- client half: CJS bundle with __ModuleLoader__ handshake ---------------
await build({
  entryPoints: [new URL('./src/client/index.jsx', import.meta.url).pathname],
  outfile: new URL('./lib/client.js', import.meta.url).pathname,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  charset: 'utf8',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react'],
  legalComments: 'inline',
  sourcemap: 'external',
  minify: false,
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: function (require) {`,
      `var module = { exports: {} }; var exports = module.exports;`,
    ].join('\n'),
  },
  footer: {
    js: `\nreturn module.exports; } });`,
  },
})

// --- post-build self-checks -------------------------------------------------
const client = await readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
if (!client.includes('__ModuleLoader__.load')) {
  throw new Error('build output missing __ModuleLoader__.load handshake')
}
// Import the host bundle for real — catches unresolved relative imports that
// a syntax-only check (node --check) would miss.
const host = await import(pathToFileURL(new URL('./lib/index.js', import.meta.url).pathname).href)
if (typeof host.apply !== 'function' || !Array.isArray(host.inject)) {
  throw new Error('host bundle is missing the plugin face (apply/inject)')
}
console.log(`[dsh-plugin-playwithai-hub] built lib/index.js + lib/client.js (id=${id})`)
