#!/usr/bin/env node

const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

// ───── CONFIG ───────────────────────────────────────────────────────────────
// 1) Configure these once and forget
const mdPath      = '/Users/madushika/vscode-authord/example/authord/topics/';
const imagesPath  = '/Users/madushika/vscode-authord/example/authord/images';
// const pageId      = '1310725';
const baseUrl     = 'https://p19951115.atlassian.net';
const email       = 'p19951115@gmail.com';
const apiToken = 'ATATT3xFfGF05tPk8zxE5zoot_a_jMb4ozEPx5UUAdLXSo19uT8JhWJfRPbKZJptiUpoyamQtcLAlc6Xw5bRooNhxjtclxDGM5yQ-SfmxzLEVJA8hySGPW7SvT6zaK2bBbe836Sd6esGqaoGPQ89EN0fWb6wFnuuhNI9lLbajt4hWFI-eMwFgRg=ED646490';
const confluenceSpace = 'MS';                 
const parentPageId = '7700734';  
// ───────────────────────────────────────────────────────────────────────

if (!mdPath || !imagesPath  || !baseUrl || !email || !apiToken) {
  console.error(`Error: missing one of required values:
  mdPath=${mdPath}
  imagesPath=${imagesPath}

  baseUrl=${baseUrl}
  email=${email}
  apiToken=${apiToken}`);
  process.exit(1);
}   
// || !pageId
// pageId=${pageId}

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
  cmd = 'npx';
  args = ['ts-node', tsScript, mdPath, imagesPath, confluenceSpace];
  if (parentPageId) args.push(parentPageId);
} else if (fs.existsSync(jsScript)) {
  cmd = jsScript;
  args = [mdPath, imagesPath, confluenceSpace];
  if (parentPageId) args.push(parentPageId);
} else {
  console.error('Error: neither publish.ts nor publish.js found.');
  process.exit(1);
}

console.log(`\n> ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, args, { stdio: 'inherit', env });
child.on('error', e => {
  console.error('Failed to start publishing script:', e);
  process.exit(1);
});
child.on('exit', code => process.exit(code));