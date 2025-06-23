#!/usr/bin/env node

const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

// ───────────────────────────────────────────────────────────────────────
// 1) Configure these once and forget
// ───────────────────────────────────────────────────────────────────────
const mdPath   = '/Users/madushika/vscode-authord/example/authord/topics/authord-settings.md';            // ← your Markdown file
const pageId   = '1310725';                        // ← your Confluence page ID
const baseUrl  = 'https://p19951115.atlassian.net';  // ← your Confluence base URL
const email    = 'p19951115@gmail.com';              // ← your Confluence user email
const apiToken = 'ATATT3xFfGF05tPk8zxE5zoot_a_jMb4ozEPx5UUAdLXSo19uT8JhWJfRPbKZJptiUpoyamQtcLAlc6Xw5bRooNhxjtclxDGM5yQ-SfmxzLEVJA8hySGPW7SvT6zaK2bBbe836Sd6esGqaoGPQ89EN0fWb6wFnuuhNI9lLbajt4hWFI-eMwFgRg=ED646490';              // ← your Confluence API token

// ───────────────────────────────────────────────────────────────────────
// 2) Validate
// ───────────────────────────────────────────────────────────────────────
if (!mdPath || !pageId || !baseUrl || !email || !apiToken) {
  console.error(`Error: missing one of required values:
  mdPath=${mdPath}
  pageId=${pageId}
  baseUrl=${baseUrl}
  email=${email}
  apiToken=${apiToken}`);
  process.exit(1);
}

// ───────────────────────────────────────────────────────────────────────
// 3) Prepare environment for publish.ts/js
// ───────────────────────────────────────────────────────────────────────
const env = {
  ...process.env,
  CONF_BASE_URL: baseUrl,
  CONF_USER:     email,
  CONF_TOKEN:    apiToken,
};

const baseDir  = path.resolve(__dirname);
const tsScript = path.join(baseDir, 'publish.ts');
const jsScript = path.join(baseDir, 'publish.js');

let cmd, args;

if (fs.existsSync(tsScript)) {
  // use ts-node for the TypeScript version
  cmd  = 'npx';
  args = ['ts-node', tsScript, mdPath, pageId];
} else if (fs.existsSync(jsScript)) {
  // run the JavaScript version directly
  cmd  = jsScript;
  args = [mdPath, pageId];
} else {
  console.error('Error: neither publish.ts nor publish.js found in:', baseDir);
  process.exit(1);
}

// ───────────────────────────────────────────────────────────────────────
// 4) Invoke the publisher
// ───────────────────────────────────────────────────────────────────────
console.log(`\n> ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, args, { stdio: 'inherit', env });

child.on('error', e => {
  console.error('Failed to start publish script:', e.message);
  process.exit(1);
});
child.on('exit', code => process.exit(code));
