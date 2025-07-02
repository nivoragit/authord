#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ───── CONFIG — adjust for your project ─────────────────────────
const mdPath = '/Users/madushika/vscode-authord/example/writerside/topics';
const imagesPath = '/Users/madushika/vscode-authord/example/writerside/images';
const baseUrl = 'https://p19951115.atlassian.net';
const email = 'p19951115@gmail.com';
const apiToken = 'ATATT3xFfGF05tPk8zxE5zoot_a_jMb4ozEPx5UUAdLXSo19uT8JhWJfRPbKZJptiUpoyamQtcLAlc6Xw5bRooNhxjtclxDGM5yQ-SfmxzLEVJA8hySGPW7SvT6zaK2bBbe836Sd6esGqaoGPQ89EN0fWb6wFnuuhNI9lLbajt4hWFI-eMwFgRg=ED646490';
const confluenceSpace = 'MS3';
const parentPageId = '8127080';
const configPath = '/Users/madushika/vscode-authord/example/writerside';
// ────────────────────────────────────────────────────────────────

if (!mdPath || !imagesPath || !baseUrl || !email || !apiToken || !configPath) {
  console.error('Error: one of the required CONFIG values is missing.');
  process.exit(1);
}
if (!fs.existsSync(configPath)) {
  console.error(`Error: couldn’t find TOC directory at ${configPath}`);
  process.exit(1);
}

const baseDir = path.resolve(__dirname);
const tsScript = path.join(baseDir, 'publish.ts');
const jsScript = path.join(baseDir, 'publish.js');

const env = {
  ...process.env,
  CONF_BASE_URL: baseUrl,
  CONF_USER: email,
  CONF_TOKEN: apiToken,
};

let cmd, args;
if (fs.existsSync(tsScript)) {
  cmd = 'npx';
  args = [
    'ts-node', tsScript,
    mdPath, imagesPath, confluenceSpace,
    '--toc-dir', configPath, 
    '--parent-root', parentPageId             
  ];
} else if (fs.existsSync(jsScript)) {
  cmd = jsScript;
  args = [
    mdPath, imagesPath, confluenceSpace,
    '--toc-dir', configPath,
    '--parent-root', parentPageId
  ];
} else {
  console.error('Error: neither publish.ts nor publish.js found.');
  process.exit(1);
}

console.log(`\n> ${cmd} ${args.map(a => (/ /.test(a) ? `"${a}"` : a)).join(' ')}\n`);
const child = spawn(cmd, args, { stdio: 'inherit', env });
child.on('error', e => {
  console.error('❌ Failed to start publishing script:', e);
  process.exit(1);
});
child.on('exit', code => process.exit(code));
