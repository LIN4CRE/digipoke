/**
 * build-single.mjs — One-file build.
 *
 *   node tools/build-single.mjs   →   dist/digipoke.html
 *
 * DigiPoke normally ships as a folder of ES modules (correct for the PWA:
 * cacheable, service-worker friendly, no build step). Some situations want a
 * single artefact instead — emailing it, dropping it on a static host, or
 * opening it straight from disk — so this tool produces a self-contained HTML
 * file with every module, stylesheet and icon inlined.
 *
 * How it works
 * ------------
 * Each module is embedded as a string. At boot the page rewrites every relative
 * import specifier to a placeholder, creates a `blob:` URL for each module in
 * dependency order (a module's dependencies are always created first), and then
 * dynamically imports the entry module. Blob URLs are ordinary URLs, so the
 * browser's module loader resolves them natively — no bundler, no renaming,
 * no risk of clashing top-level names.
 *
 * Prerequisites this build enforces (checked before writing anything):
 *   • the module graph is acyclic (a cycle cannot be expressed as blobs)
 *   • no `export … from` re-exports (they would need a different rewrite)
 *   • every embedded module parses on its own (syntax check)
 *
 * The service worker is intentionally omitted: a `file://` or blob-loaded page
 * has no origin to scope a worker to. Everything else — IndexedDB, crypto,
 * offline play — works exactly as it does in the folder build.
 *
 * @module tools/build-single
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps', 'web');
const OUT_DIR = path.join(ROOT, 'dist');
const ENTRY = 'src/main.js';

/* ------------------------------------------------------------ module graph */

/** Recursively collect .js files under `dir`. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}
const files = walk(path.join(WEB, 'src')).map((f) => path.relative(WEB, f).split(path.sep).join('/'));

// Strip comments first so JSDoc `{import('./db.js')}` type expressions are not
// mistaken for real dependencies.
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Static imports and dynamic imports that resolve to a local module. */
function depsOf(rawSource, file) {
  const source = stripComments(rawSource);
  const deps = [];
  const specRe = /(?:^|[\s;{}])(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]/g;
  const dynRe = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(specRe)) deps.push(m[1]);
  for (const m of source.matchAll(dynRe)) deps.push(m[1]);
  return [...new Set(deps)].map((spec) => normalise(path.join(path.dirname(file), spec)));
}

/** Normalise a path to the project-relative POSIX form used as the module key. */
function normalise(p) {
  const absolute = path.isAbsolute(p) ? p : path.resolve(WEB, p);
  return path.relative(WEB, absolute).split(path.sep).join('/');
}

const sources = new Map();
const graph = new Map();
for (const file of files) {
  const source = readFileSync(path.join(WEB, file), 'utf8');
  sources.set(file, source);
  graph.set(file, depsOf(source, file));
}

/* ----------------------------------------------------------------- checks */

for (const [file, deps] of graph) {
  for (const dep of deps) {
    if (!sources.has(dep)) {
      throw new Error(`${file} imports ${dep}, which does not exist`);
    }
  }
}

// 1. Acyclic. A blob module cannot import a module created after it.
const order = [];
const mark = new Map();
function visit(node, stack) {
  if (mark.get(node) === 'done') return;
  if (mark.get(node) === 'open') {
    throw new Error(`import cycle: ${[...stack, node].join(' -> ')}`);
  }
  mark.set(node, 'open');
  for (const dep of graph.get(node) || []) visit(dep, [...stack, node]);
  mark.set(node, 'done');
  order.push(node);
}
for (const file of files) visit(file, []);

// 2. No re-exports (this rewrite only handles local declarations).
for (const [file, source] of sources) {
  for (const m of source.matchAll(/^\s*export\s+[^*\w].*\bfrom\s*['"]/gm)) {
    throw new Error(`${file} uses a re-export, which this build does not rewrite: ${m[0].trim()}`);
  }
}

// 3. Every module parses (delegated to `node --check`, the authority on syntax).
const tmpDir = mkdtempSync(path.join(tmpdir(), 'digipoke-build-'));
try {
  for (const [file, source] of sources) {
    const tmp = path.join(tmpDir, file.split('/').join('__'));
    writeFileSync(tmp, source);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (err) {
      throw new Error(`${file} failed to parse: ${String(err.stderr || err.message).trim()}`);
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ assets */

const css = ['tokens.css', 'app.css']
  .map((f) => readFileSync(path.join(WEB, 'styles', f), 'utf8'))
  .join('\n\n/* --------------------------------------------------------------- */\n\n');

/** Inline an SVG asset as a data URI (used by the manifest/icons). */
const dataUri = (relPath, mime) => {
  const body = readFileSync(path.join(WEB, relPath), 'utf8');
  return `data:${mime};utf8,${encodeURIComponent(body).replace(/'/g, '%27')}`;
};

const manifestObj = JSON.parse(readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
manifestObj.icons = (manifestObj.icons || []).map((icon) => {
  const file = icon.src.replace(/^\.?\//, '');
  return { ...icon, src: existsSync(path.join(WEB, file)) ? dataUri(file, 'image/svg+xml') : icon.src };
});
const manifest = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifestObj))}`;

const iconSvg = readFileSync(path.join(WEB, 'assets', 'icon.svg'), 'utf8');

/* ----------------------------------------------------------------- output */

/**
 * Rewrite each module's relative specifiers to `«key»` placeholders. The
 * runtime replaces a placeholder with the blob URL created for that key.
 */
const modules = order.map((file) => {
  let code = sources.get(file);
  for (const dep of graph.get(file)) {
    const spec = path.relative(path.dirname(file), dep).split(path.sep).join('/');
    const withExt = spec.startsWith('.') ? spec : `./${spec}`;
    // Replace both the quoted forms that can appear for this specifier.
    code = code.split(`'${withExt}'`).join(`'«${dep}»'`)
      .split(`"${withExt}"`).join(`"«${dep}»"`);
  }
  // Safety net: nothing should be left pointing at a relative module.
  // (Checked against comment-stripped code: JSDoc `{import('./x.js')}` types
  // are documentation, not dependencies.)
  const codeNoComments = stripComments(code);
  const leftover = [
    ...codeNoComments.matchAll(/from\s*['"](\.[^'"]+)['"]/g),
    ...codeNoComments.matchAll(/import\(\s*['"](\.[^'"]+)['"]/g),
  ];
  if (leftover.length) {
    throw new Error(`${file} still references ${leftover.map((m) => m[1]).join(', ')} after rewriting`);
  }
  return { key: file, code };
});

const html = readFileSync(path.join(WEB, 'index.html'), 'utf8');

// Strip the external stylesheet/script tags; both are inlined below.
const body = html
  .replace(/<link rel="stylesheet"[^>]*>/g, '')
  .replace(/<link rel="manifest"[^>]*>/g, '')
  .replace(/<script type="module"[^>]*><\/script>/g, '')
  .replace(/<link rel="(apple-touch-)?icon"[^>]*>/g, '');

const payload = JSON.stringify({ entry: ENTRY, modules });

const headInject = `  <link rel="manifest" href="${manifest}" />
  <link rel="icon" href="data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}" />
  <link rel="apple-touch-icon" href="data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}" />
  <style>
${css}
  </style>
  <script id="digipoke-modules" type="application/json">
${payload.replace(/<\//g, '<\\/')}
  </script>
`;
const tailInject = `  <script type="module">
  /**
   * Blob-URL module loader for the single-file build.
   *
   * Creates one blob URL per module, in dependency order, substituting the
   * «key» placeholders with the URLs created before it, then boots the app by
   * importing the entry module. Same code, same semantics — just no files.
   */
  const payload = JSON.parse(document.getElementById('digipoke-modules').textContent);
  const urls = new Map();

  for (const mod of payload.modules) {
    let code = mod.code;
    for (const [key, url] of urls) {
      code = code.split('«' + key + '»').join(url);
    }
    if (code.includes('«')) {
      throw new Error('Unresolved module placeholder in ' + mod.key);
    }
    urls.set(mod.key, URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  }

  const entryUrl = urls.get(payload.entry);
  if (!entryUrl) throw new Error('Entry module not found: ' + payload.entry);
  import(entryUrl).catch((err) => {
    console.error(err);
    document.body.innerHTML = '<pre style="padding:24px;color:#ff8f7a;white-space:pre-wrap">'
      + 'DigiPoke failed to start:\\n' + (err && err.stack ? err.stack : err) + '</pre>';
  });
  </script>
`;

// Function replacements: module source legitimately contains `$&` and friends
// (they appear in the router's own regex code), and a string replacement would
// expand them into the matched text and corrupt the payload.
const out = body
  .replace('</head>', () => headInject)
  .replace('</body>', () => tailInject);

mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'digipoke.html');
writeFileSync(outFile, out);

const kb = (readFileSync(outFile, 'utf8').length / 1024).toFixed(0);
console.log(`wrote dist/digipoke.html (${kb} KB, ${modules.length} modules, ${order.length} in dependency order)`);
console.log('open it directly, or host the single file anywhere static');
