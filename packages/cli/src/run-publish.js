#!/usr/bin/env node

const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

// ───────────────────────────────────────────────────────────────────────
// 1) Configure these once and forget
const mdPath      = '/Users/madushika/vscode-authord/example/authord/topics/';
const imagesPath  = '/Users/madushika/vscode-authord/example/authord/images';
const pageId      = '1310725';
const baseUrl     = 'https://p19951115.atlassian.net';
const email       = 'p19951115@gmail.com';
const apiToken    = 'YOUR_CONFLUENCE_API_TOKEN';
// ───────────────────────────────────────────────────────────────────────

if (!mdPath || !imagesPath || !pageId || !baseUrl || !email || !apiToken) {
  console.error(`Error: missing one of required values:
  mdPath=${mdPath}
  imagesPath=${imagesPath}
  pageId=${pageId}
  baseUrl=${baseUrl}
  email=${email}
  apiToken=${apiToken}`);
  process.exit(1);
}

const env = {
  ...process.env,
  CONF_BASE_URL: baseUrl,
  CONF_USER    : email,
  CONF_TOKEN   : apiToken,
};

const baseDir  = path.resolve(__dirname);
const tsScript = path.join(baseDir, 'publish.ts');
const jsScript = path.join(baseDir, 'publish.js');

let cmd, args;
if (fs.existsSync(tsScript)) {
  cmd  = 'npx';
  args = ['ts-node', tsScript, mdPath, imagesPath, pageId];
} else if (fs.existsSync(jsScript)) {
  cmd  = jsScript;
  args = [mdPath, imagesPath, pageId];
} else {
  console.error('Error: neither publish.ts nor publish.js found in:', baseDir);
  process.exit(1);
}

console.log(`\n> ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, args, { stdio: 'inherit', env });
child.on('error', e => {
  console.error('Failed to start publish script:', e.message);
  process.exit(1);
});
child.on('exit', code => process.exit(code));