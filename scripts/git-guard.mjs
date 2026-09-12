#!/usr/bin/env node
/** Vendored from sports-federation/scripts/git-guard.mjs */
import { readFileSync, existsSync, statSync } from 'node:fs';
const mode = process.argv[2];
const files = process.argv.slice(3);
if (mode === 'commit-msg') {
  const msgFile = files[0];
  if (!msgFile || !existsSync(msgFile)) process.exit(0);
  const firstLine = readFileSync(msgFile, 'utf8').trim().split('\n')[0];
  const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9_\-.]+\))?!?: .{1,100}$/;
  if (!conventionalRegex.test(firstLine)) { console.error('[GIT GUARD] Invalid commit message'); process.exit(1); }
  process.exit(0);
}
if (mode === 'tokens') {
  const codeLeakRegex = /(?:\[object Object\]|\[PVM\]|(?:\b(?:undefined|null|NaN)\b\s*\+)|(?:\+\s*\b(?:undefined|null|NaN)\b)|\$\{\s*(?:undefined|null|NaN)\s*\}|>\s*(?:undefined|null|NaN)\s*<)/;
  const nonCodeLeakRegex = /(?:\b(?:undefined|null|NaN)\b|\[object Object\]|\[PVM\])/;
  let hasLeak = false;
  for (const file of files) {
    if (!existsSync(file)) continue;
    try { if (statSync(file).isDirectory()) continue; } catch { continue; }
    if (file.includes('node_modules') || file.includes('.git') || file.includes('dist')) continue;
    const lower = file.toLowerCase();
    if (lower.includes('test') || lower.includes('git-guard')) continue;
    const isCode = /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file);
    const isMarkdown = /\.md$/i.test(file);
    const lines = readFileSync(file, 'utf8').split('\n');
    let inMd = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]; const trimmed = line.trim();
      if (trimmed.includes('git-guard-ignore')) continue;
      if (isCode && (trimmed.startsWith('//') || trimmed.startsWith('*'))) continue;
      if (isMarkdown) { if (trimmed.startsWith('```')) { inMd = !inMd; continue; } if (inMd) continue; }
      const isDocs = file.includes('/docs/') || file.startsWith('docs');
      const regex = isCode ? codeLeakRegex : (isDocs ? /(?:\[object Object\]|\[PVM\])/ : nonCodeLeakRegex);
      if (regex.test(isMarkdown ? line.replace(/`[^`]*`/g, '') : line)) { console.error(`[GIT GUARD] leak ${file}:${i + 1}`); hasLeak = true; }
    }
  }
  process.exit(hasLeak ? 1 : 0);
}
if (mode === 'secrets') {
  let hasSecret = false;
  for (const file of files) {
    if (!existsSync(file)) continue;
    try { if (statSync(file).isDirectory()) continue; } catch { continue; }
    if (file.includes('node_modules') || file.includes('.git') || file.includes('dist') || file.includes('git-guard')) continue;
    const isEnv = /\.env/i.test(file) && !/example|sample|template/i.test(file);
    if (isEnv || /\.(pem|key)$/i.test(file)) { console.error(`[GIT GUARD] credentials ${file}`); hasSecret = true; continue; }
    const content = readFileSync(file, 'utf8');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) || /AKIA[0-9A-Z]{16}/.test(content)) { console.error(`[GIT GUARD] secret ${file}`); hasSecret = true; }
  }
  process.exit(hasSecret ? 1 : 0);
}
console.log('[GIT GUARD] Usage: node git-guard.mjs <tokens|secrets|commit-msg>');
process.exit(0);
