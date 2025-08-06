#!/usr/bin/env node
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { spawn } = require('child_process');
const minimist  = require('minimist');
const { XMLParser } = require('fast-xml-parser');

/* ───────────────────────── 1. CLI & JSON config ───────────────────────── */
const argv = minimist(process.argv.slice(2), {
  string: [
    'config', 'token', 'project-type',
    'md', 'images', 'space', 'title',
    'base-url',             // ↩︎ unchanged
    'user',                 // NEW: --user <username>
    'username'              // alias for --user in JSON/env
  ],
  alias: { c: 'config', t: 'token', u: 'user' },
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
  if (argv[flag]                      !== undefined) return argv[flag];
  if (jsonCfg[key]                    !== undefined) return jsonCfg[key];
  if (process.env[key.toUpperCase()]  !== undefined) return process.env[key.toUpperCase()];
  return fallback;
};

const root = process.cwd();

/* ───────────────────────── 2. Detect project type ─────────────────────── */
let projectType = argv['project-type'] || jsonCfg.projectType;
if (!projectType) {
  if (fs.existsSync(path.join(root, 'authord.config.json'))) projectType = 'authord';
  else if (fs.existsSync(path.join(root, 'writerside.cfg'))) projectType = 'writerside';
}
if (!projectType) {
  console.error(
    '❌  Could not determine project type (authord / writerside).\n' +
    '    Use --project-type to specify.'
  );
  process.exit(1);
}

/* ───────────────────────── 3. Derive default dirs ─────────────────────── */
const defaults = {};
if (projectType === 'authord') {
  const cfgPath = path.join(root, 'authord.config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    defaults.topicsDir = cfg.topics?.dir;
    defaults.imagesDir = cfg.images?.dir;
  }
} else {
  const cfgPath = path.join(root, 'writerside.cfg');
  if (fs.existsSync(cfgPath)) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const ihp = parser.parse(fs.readFileSync(cfgPath, 'utf8')).ihp || {};
    defaults.topicsDir = ihp.topics?.['@_dir'];
    defaults.imagesDir = ihp.images?.['@_dir'];
  }
}

/* ───────────────────────── 4. Resolve inputs ─────────────────────────── */
const mdPath       = pick('md',     'topicsDir', defaults.topicsDir && path.resolve(root, defaults.topicsDir));
const imagesSource = pick('images', 'imagesDir', defaults.imagesDir && path.resolve(root, defaults.imagesDir));
const spaceKey     = pick('space',  'spaceKey');
const pageTitle    = pick('title',  'pageTitle', 'Exported Documentation');
const baseUrl      = pick('base-url','baseUrl');
const username     = pick('user',   'username');     // ← NEW (Data Center)
const apiToken     = pick('token',  'apiToken');

/* -------- minimal validation -------- */
for (const [k, v] of Object.entries({ mdPath, imagesSource, spaceKey, baseUrl, username, apiToken })) {
  if (!v) { console.error(`Missing required option: ${k}`); process.exit(1); }
}

/* ───────────────────────── 5. Cache images ───────────────────────────── */
const cacheDir = path.join(os.tmpdir(), 'writerside-diagrams');
fs.mkdirSync(cacheDir, { recursive: true });
for (const img of fs.readdirSync(imagesSource)) {
  const src = path.join(imagesSource, img);
  const dst = path.join(cacheDir, img);
  try {
    fs.copyFileSync(src, dst);
  } catch (err) {
    console.warn(`⚠️  Failed to copy image ${img}:`, err.message);
  }
}

/* ───────────────────────── 6. Choose publisher impl ───────────────────── */
const scriptDir = __dirname;
const tsSingle  = path.join(scriptDir, '../publish-single.ts');
if (!fs.existsSync(tsSingle)) {
  console.error('❌  Could not find publish-single.ts next to publish.js');
  process.exit(1);
}

/* ───────────────────────── 7. Spawn! ─────────────────────────────────── */
const cmd  = 'npx';
const args = [
  'ts-node', tsSingle,
  '--md',     mdPath,
  '--images', cacheDir,
  '--space',  spaceKey,
  '--title',  pageTitle,
];

console.log(`\n> ${cmd} ${args.map(a => (/ /.test(a) ? `"${a}"` : a)).join(' ')}\n`);

const child = spawn(cmd, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CONF_BASE_URL : baseUrl,
    CONF_USERNAME : username,   // NEW
    CONF_TOKEN    : apiToken,   // PAT or password
  },
});
child.on('exit', code => process.exit(code ?? 0));
