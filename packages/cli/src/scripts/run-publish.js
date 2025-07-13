#!/usr/bin/env node
const fs        = require('fs');
const path      = require('path');
const { spawn } = require('child_process');
const minimist  = require('minimist');
const { XMLParser } = require('fast-xml-parser');

/* ───────────────────────── 1. CLI & JSON config ────────────────────────── */
const argv   = minimist(process.argv.slice(2), {
  string: [
    'config', 'token', 'project-type',
    'md', 'images', 'space', 'parent',
    'base-url', 'email'
  ],
  alias: { c: 'config', t: 'token' },
});

function loadJson(file) {
  if (!file) return {};
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`Config file not found: ${full}`);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}
const jsonCfg = loadJson(argv.config);

/* helper: CLI > JSON > ENV > fallback */
const pick = (flag, key, fallback) => {
  if (argv[flag]    !== undefined) return argv[flag];
  if (jsonCfg[key]  !== undefined) return jsonCfg[key];
  if (process.env[key.toUpperCase()] !== undefined) return process.env[key.toUpperCase()];
  return fallback;
};

const root = process.cwd();

/* ───────────────────────── 2. Detect project type ──────────────────────── */
let projectType = argv['project-type'] || jsonCfg.projectType;
if (!projectType) {
  if (fs.existsSync(path.join(root, 'authord.config.json')))       projectType = 'authord';
  else if (fs.existsSync(path.join(root, 'writerside.cfg'))) projectType = 'writerside';
}

if (!projectType) {
  console.error(
    '❌  Could not determine project type (authord / writerside).\n' +
    '    Use --project-type to specify.'
  );
  process.exit(1);
}

/* ───────────────────────── 3. Derive default dirs ──────────────────────── */
const defaults = {};
if (projectType === 'authord') {
  const cfgPath = path.join(root, 'authord.config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    defaults.topicsDir = cfg.topics?.dir;
    defaults.imagesDir = cfg.images?.dir;
  }
} else { // writerside only via writerside.cfg
  const cfgPath = path.join(root, 'writerside.cfg');
  if (fs.existsSync(cfgPath)) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const ihp = parser.parse(fs.readFileSync(cfgPath, 'utf8')).ihp || {};
    defaults.topicsDir = ihp.topics?.['@_dir'];
    defaults.imagesDir = ihp.images?.['@_dir'];
  }
}

/* ───────────────────────── 4. Resolve all inputs ───────────────────────── */
const mdPath        = pick('md',     'topicsDir', defaults.topicsDir && path.resolve(root, defaults.topicsDir));
const imagesPath    = pick('images', 'imagesDir', defaults.imagesDir && path.resolve(root, defaults.imagesDir));
const spaceKey      = pick('space',  'spaceKey');
const parentPageId  = pick('parent', 'parentPageId');
const baseUrl       = pick('base-url', 'baseUrl');
const email         = pick('email', 'email');
const apiToken      = pick('token', 'apiToken');
const tocDir        = root;   // always project root

/* -------- minimal validation -------- */
for (const [k, v] of Object.entries({ mdPath, imagesPath, spaceKey, parentPageId, baseUrl, email, apiToken })) {
  if (!v) { console.error(`Missing required option: ${k}`); process.exit(1); }
}

/* ───────────────────────── 5. Choose publisher impl ────────────────────── */
const scriptDir = __dirname;
const tsScript  = path.join(scriptDir, '../publish.ts');
let cmd, args;
if (fs.existsSync(tsScript)) {
  cmd  = 'npx';
  args = ['ts-node', tsScript];
} else {
  console.error('❌  Neither publish.ts nor publish.js found');
  process.exit(1);
}

args.push(
  mdPath, imagesPath, spaceKey,
  '--toc-dir', tocDir,
  '--parent-root', parentPageId,
  '--project-type', projectType,
);

/* ───────────────────────── 6. Spawn! ───────────────────────────────────── */
console.log(`\n> ${cmd} ${args.map(a => (/ /.test(a) ? `"${a}"` : a)).join(' ')}\n`);

const child = spawn(cmd, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CONF_BASE_URL: baseUrl,
    CONF_USER    : email,
    CONF_TOKEN   : apiToken,
  },
});
child.on('exit', code => process.exit(code ?? 0));
