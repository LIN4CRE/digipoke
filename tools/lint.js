/**
 * lint.js — Dependency-free project checks.
 *
 *   npm run lint
 *
 * A conventional linter (ESLint) needs several hundred packages. This script
 * enforces the handful of rules that actually matter for this codebase, with
 * zero install:
 *
 *   1. Every relative ES module import resolves to a real file.
 *   2. The service worker's precache list matches files that exist.
 *   3. No placeholder markers (TODO/FIXME/XXX/not implemented) in shipped code.
 *   4. No hard-coded external URLs — the PWA must work fully offline.
 *   5. No accidental `debugger` statements or `innerHTML` from variables.
 *
 * @module tools/lint
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps', 'web');

const errors = [];
const warnings = [];

/** Recursively collect files with the given extensions. */
function walk(dir, exts, skip = ['node_modules', 'data', '.git']) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (skip.includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts, skip));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p);

/** Files exempt from specific rules, with the reason recorded inline. */
const SELF = path.join(__dirname, 'lint.js');
const INNERHTML_ALLOWED = new Set([
  // dom.js is the single, documented escape hatch: the `html` prop is only ever
  // fed our own sprite generator (no user data), and every other screen uses it.
  path.join(WEB, 'src', 'ui', 'dom.js'),
]);

/* ------------------------------------------------- 1. import resolution */

for (const file of walk(ROOT, ['.js', '.mjs'])) {
  const source = readFileSync(file, 'utf8');
  const importRe = /(?:^|\s)(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRe.exec(source))) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue; // bare specifier (node:*, packages)
    const target = path.resolve(path.dirname(file), spec);
    if (!existsSync(target)) {
      errors.push(`${rel(file)} imports '${spec}', which does not exist`);
    }
  }
}

/* ------------------------------------------- 2. service worker precache */

const swPath = path.join(WEB, 'sw.js');
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  const block = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  if (block) {
    const assets = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const asset of assets) {
      const target = path.join(WEB, asset.replace(/^\.\//, ''));
      if (!existsSync(target)) errors.push(`sw.js precaches missing file: ${asset}`);
    }
    // The reverse check matters more: a new screen that is not precached
    // silently breaks offline launches.
    for (const file of walk(path.join(WEB, 'src'), ['.js'])) {
      const asUrl = `./${rel(file).replace('apps/web/', '')}`;
      if (!assets.includes(asUrl)) errors.push(`not precached by sw.js: ${asUrl}`);
    }
  }
}

/* ------------------------------------------- 3. placeholders & debugging */

const PLACEHOLDERS = /\b(TODO|FIXME|XXX|HACK|not implemented|coming soon)\b/i;
for (const file of walk(path.join(ROOT, 'apps'), ['.js', '.css', '.html'])
  .concat(walk(path.join(ROOT, 'server'), ['.js']))
  .concat(walk(path.join(ROOT, 'tools'), ['.js']))
  .filter((f) => f !== SELF)) { // the linter's own patterns are not placeholders

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (PLACEHOLDERS.test(line) && !line.trim().startsWith('*')) {
      errors.push(`${rel(file)}:${i + 1} placeholder marker: ${line.trim().slice(0, 80)}`);
    }
    if (/\bdebugger\b/.test(line)) errors.push(`${rel(file)}:${i + 1} contains a debugger statement`);
  });
}

/* ------------------------------------------------------ 4. external URLs */

const URL_IN_CODE = /https?:\/\/(?!localhost|127\.0\.0\.1|schema\.org|www\.w3\.org)[^\s'"`)]+/g;
for (const file of walk(path.join(WEB, 'src'), ['.js'])) {
  const source = readFileSync(file, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const found = code.match(URL_IN_CODE);
  if (found) {
    errors.push(`${rel(file)} references external URL(s): ${[...new Set(found)].join(', ')} — the PWA must run offline`);
  }
}

/* ------------------------------------------------------- 5. innerHTML use */

for (const file of walk(path.join(WEB, 'src'), ['.js']).filter((f) => !INNERHTML_ALLOWED.has(f))) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (/\.innerHTML\s*=/.test(line)) {
      warnings.push(`${rel(file)}:${i + 1} assigns innerHTML directly (XSS risk)`);
    }
  });
}

/* ------------------------------------------------ 6. CSS class coverage */

/**
 * Unstyled markup is the most common way a hand-rolled UI silently rots: a
 * screen gains `.launch__bar`, nobody writes the rule, and it ships looking
 * broken. This check diffs the class names the code produces against the
 * class names the stylesheets define, and fails the build on the difference.
 */
const cssText = ['tokens.css', 'app.css']
  .map((f) => readFileSync(path.join(WEB, 'styles', f), 'utf8'))
  .join('\n');
const definedClasses = new Set(
  [...cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]),
);

// Classes generated inside inline SVG: styled by attributes, not by the sheet.
const SVG_INTERNAL = /^(sp-|portrait(__|-)|avatar(__|-))/;
// Route hooks: queried by the router and tests, but unstyled by design.
const HOOKS = /^(view--|in-onboarding)/;
// Third-party/legacy names and single-letter CSS shorthand noise.
// `avatar` is the root class of the generated Tamer SVG (attributes only).
const IGNORED = new Set(['css', 'js', 'svg', 'avatar']);

const usedClasses = new Map(); // class (or prefix) -> first file that used it
const note = (name, where) => { if (!usedClasses.has(name)) usedClasses.set(name, where); };

/** Remove `${...}` interpolations so `div.foo--${x}` is read as `div.foo--`. */
function stripInterpolations(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      i--; // land on the closing brace, the loop increment steps past it
      continue;
    }
    out += text[i];
  }
  return out;
}

/** Read the string literal that starts at `start` (quote char at that index). */
function readLiteral(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === quote) return text.slice(start + 1, i);
  }
  return '';
}

for (const file of [
  ...walk(path.join(WEB, 'src'), ['.js']),
  path.join(WEB, 'index.html'),
]) {
  const source = readFileSync(file, 'utf8');
  const where = rel(file);

  // h('div.foo.bar') / h(`button.opt${x ? '.is-active' : ''}`)
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== 'h' || source[i + 1] !== '(') continue;
    let j = i + 2;
    while (j < source.length && /\s/.test(source[j])) j++;
    if (![`'`, '"', '`'].includes(source[j])) continue;
    const literal = stripInterpolations(readLiteral(source, j));
    for (const cls of literal.matchAll(/\.([a-zA-Z][\w-]*)/g)) note(cls[1], where);
    i = j;
  }
  // classList.add/remove/toggle('foo') and classList.contains('foo')
  for (const m of source.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"]([^'"]+)['"]/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls) note(cls, where);
  }
  // class="..." in index.html and in generated SVG strings
  for (const m of source.matchAll(/class\s*=\s*[`'"`"]([^`'"`"]*)[`'"`"]/g)) {
    for (const cls of stripInterpolations(m[1]).split(/\s+/)) if (cls) note(cls, where);
  }
}

for (const [cls, where] of [...usedClasses].sort()) {
  if (IGNORED.has(cls) || SVG_INTERNAL.test(cls) || HOOKS.test(cls)) continue;
  // A class ending in '-' is a prefix left over from an interpolated modifier
  // (e.g. `.hp__fill--${state}`); it is satisfied by any rule that starts with it.
  const satisfied = /-$/.test(cls)
    ? [...definedClasses].some((d) => d.startsWith(cls))
    : definedClasses.has(cls);
  if (!satisfied) {
    errors.push(`${where} uses CSS class ".${cls}" with no rule in styles/ — add it or rename it`);
  }
}

/* ---------------------------------------------------------------- report */

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const GREY = '\x1b[90m';

for (const w of warnings) console.log(`${YELLOW}warn${RESET}  ${w}`);
for (const e of errors) console.log(`${RED}error${RESET} ${e}`);

if (!errors.length) {
  console.log(`${GREEN}lint ok${RESET} ${GREY}(${warnings.length} warning${warnings.length === 1 ? '' : 's'})${RESET}`);
  process.exit(0);
}
console.log(`\n${RED}${errors.length} error(s)${RESET}, ${warnings.length} warning(s)`);
process.exit(1);
