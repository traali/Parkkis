#!/usr/bin/env node
/**
 * Chapter of Neighbors
 *
 * Each monastery verifies the houses it depends on are in line (contracts,
 * AGENTS.md rules, 5-point test plans) and working (live HTTP, TASO origin).
 *
 * Blocking  → local contract drift vs canonical, missing AGENTS.md / visit script,
 *             neighbor GitHub 404, canonical interface deleted.
 * Advisory  → prod HTTP, TASO cache 403, SHA lag, plan files without 5-point spec.
 *
 * Future changes: this script is hooked from `npm run visit`. Removing a required
 * contract field, dropping AGENTS.md, or deleting a neighbor repo fails the gate.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = process.cwd()
const UA = 'monastic-neighbors/1.0 (+https://github.com/traali/sports-federation)'
const RAW = 'https://raw.githubusercontent.com/traali'
const TIMEOUT_MS = 10_000

const PLAN_MARKERS = [
  /user journey/i,
  /when it succeeds/i,
  /when it should fail/i,
]

function detectRepo() {
  try {
    const url = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim()
    const m = url.match(/github\.com[:/][^/]+\/([^/.]+)(?:\.git)?$/i)
    if (m) return m[1]
  } catch { /* fall through */ }
  if (existsSync(join(ROOT, 'package.json'))) {
    try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name } catch { /* */ }
  }
  return null
}

async function getText(url, headers = {}, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal, redirect: 'follow' })
    const body = await res.text()
    return { ok: res.ok, status: res.status, body, headers: res.headers }
  } catch (err) {
    return { ok: false, status: 0, body: '', error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(t)
  }
}

async function getGithubFile(repoName, branch, filePath) {
  // Prefer GitHub API (not CDN-cached). CI has GITHUB_TOKEN; local has `gh`.
  const api = `https://api.github.com/repos/traali/${repoName}/contents/${filePath}?ref=${branch}`
  const headers = { Accept: 'application/vnd.github.raw+json' }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const apiRes = await getText(api, headers)
  if (apiRes.ok && apiRes.body.includes('interface')) return apiRes

  try {
    const b64 = execSync(
      `gh api "repos/traali/${repoName}/contents/${filePath}?ref=${branch}" --jq .content`,
      { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (b64 && b64 !== 'null') {
      const body = Buffer.from(b64.replace(/\s/g, ''), 'base64').toString('utf8')
      if (body) return { ok: true, status: 200, body }
    }
  } catch { /* fall through to raw CDN */ }

  return getText(`${RAW}/${repoName}/${branch}/${filePath}`)
}

function extractInterfaces(src) {
  const out = {}
  const re = /(?:export\s+)?interface\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  let m
  while ((m = re.exec(src))) {
    const fields = []
    for (const line of m[2].split('\n')) {
      const f = line.match(/^\s*(?:readonly\s+)?([A-Za-z_][\w]*)(\?)?\s*:/)
      if (f) fields.push({ name: f[1], optional: Boolean(f[2]) })
    }
    out[m[1]] = fields
  }
  return out
}

function findLocalContracts() {
  const candidates = [
    join(ROOT, 'src/types/contracts.ts'),
    join(ROOT, 'src/contracts.ts'),
    join(ROOT, 'web/src/lib/contracts.ts'),
    join(ROOT, 'contracts/index.ts'),
  ]
  return candidates.filter((p) => existsSync(p))
}

function findGraph() {
  const local = join(ROOT, 'federation.neighbors.json')
  const nested = join(ROOT, 'contracts/neighbors.json')
  const sibling = join(ROOT, '..', 'sports-federation', 'contracts', 'neighbors.json')
  const bundled = join(HERE, '..', 'contracts', 'neighbors.json')
  for (const p of [local, nested, sibling, bundled]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'))
  }
  return null
}

function isPlanFile(name) {
  if (!/\.md$/i.test(name)) return false
  if (/architecture|review|arvio|refactoring/i.test(name)) return false
  return /plan|spec|standard|test/i.test(name)
}

function planHasFivePoint(text) {
  return PLAN_MARKERS.every((re) => re.test(text))
}

async function probeTaso(taso) {
  if (!taso) return { skip: true }
  const origin = await getText(taso.origin, { Accept: taso.accept, Referer: taso.referer })
  if (origin.ok && origin.body.includes('{')) {
    return { ok: true, via: 'origin', status: origin.status }
  }
  const bust = taso.origin.includes('?') ? `${taso.origin}&_cb=${Date.now()}` : `${taso.origin}?_cb=${Date.now()}`
  const retry = await getText(bust, { Accept: taso.accept, Referer: taso.referer })
  if (retry.ok && retry.body.includes('{')) {
    return { ok: true, via: 'origin+_cb', status: retry.status, note: `origin ${origin.status} empty/403, cache-bust recovered` }
  }
  const proxy = taso.proxy ? await getText(taso.proxy, { Accept: 'application/json' }) : null
  if (proxy?.ok && proxy.body.includes('{')) {
    return { ok: true, via: 'proxy', status: proxy.status }
  }
  return { ok: false, via: 'none', status: origin.status, note: origin.error || `origin ${origin.status}` }
}

function logLine(kind, msg) {
  const tag = kind === 'block' ? '❌' : kind === 'ok' ? '✅' : '⚠️'
  console.log(`${tag} ${msg}`)
}

const repo = process.argv.includes('--all') ? 'sports-federation' : (detectRepo() || 'sports-federation')
const graph = findGraph()
if (!graph) {
  console.error('❌ [NEIGHBORS] No federation.neighbors.json / contracts/neighbors.json found.')
  process.exit(1)
}

const house = graph.houses[repo]
if (!house) {
  console.log('\n' + '═'.repeat(72))
  console.log(`CHAPTER OF NEIGHBORS — ${repo} (out of graph)`)
  console.log('═'.repeat(72) + '\n')
  console.log(`⚠️ No row in contracts/neighbors.json for "${repo}".`)
  console.log('   Template repos (monastic-governance) skip. Federation houses must be added to the graph.')
  console.log('✨ [NEIGHBORS] Nothing to block.\n')
  process.exit(0)
}

console.log('\n' + '═'.repeat(72))
console.log(`CHAPTER OF NEIGHBORS — ${repo} (${house.role})`)
console.log('═'.repeat(72) + '\n')

const blockers = []
const advisories = []
const oks = []

function block(msg) { blockers.push(msg); logLine('block', msg) }
function advise(msg) { advisories.push(msg); logLine('warn', msg) }
function ok(msg) { oks.push(msg); logLine('ok', msg) }

// 1. Local Rule
const agentsPath = join(ROOT, 'AGENTS.md')
if (!existsSync(agentsPath)) {
  block('AGENTS.md missing — a monastery without a Rule cannot visit neighbors.')
} else {
  const agents = readFileSync(agentsPath, 'utf8')
  const words = agents.trim().split(/\s+/).length
  if (words > 1500) block(`AGENTS.md exceeds 1500-word cap (${words}).`)
  else ok(`AGENTS.md in cap (${words} words)`)
  for (const token of graph.requiredRuleTokens || []) {
    if (!new RegExp(token, 'i').test(agents)) {
      block(`AGENTS.md missing required token "${token}" (visit gate / contract rule).`)
    }
  }
}

// 2. Canonical contracts (local copy or GitHub)
let canonicalSrc = ''
const localCanon = existsSync(join(ROOT, 'contracts/index.ts'))
  ? join(ROOT, 'contracts/index.ts')
  : existsSync(join(ROOT, '..', 'sports-federation', 'contracts', 'index.ts'))
    ? join(ROOT, '..', 'sports-federation', 'contracts', 'index.ts')
    : null
if (localCanon) canonicalSrc = readFileSync(localCanon, 'utf8')

if (!canonicalSrc) {
  const remote = await getGithubFile('sports-federation', 'main', 'contracts/index.ts')
  if (!remote.ok) block(`Cannot load canonical contracts (${remote.status} ${remote.error || ''})`)
  else canonicalSrc = remote.body
}

const canonical = canonicalSrc ? extractInterfaces(canonicalSrc) : {}
for (const iface of graph.requiredCanonicalInterfaces) {
  if (!canonical[iface]) block(`Canonical contracts missing interface ${iface}`)
}
if (graph.requiredCanonicalInterfaces.every((i) => canonical[i])) {
  ok(`Canonical contracts v-freeze: ${graph.requiredCanonicalInterfaces.join(', ')}`)
}

// 3. Local adapter vs canonical required fields
const localFiles = findLocalContracts()
if (house.provides?.length && localFiles.length === 0 && house.role !== 'kattorepo') {
  block('No local contracts adapter (src/types/contracts.ts or equivalent).')
}
const localSrc = localFiles.map((p) => readFileSync(p, 'utf8')).join('\n')
const localIfaces = extractInterfaces(localSrc)
for (const iface of house.provides || []) {
  if (house.role === 'kattorepo') continue
  if (!localSrc.includes(iface)) {
    block(`Local adapter missing provided interface ${iface}`)
    continue
  }
  const need = canonical[iface] || []
  const have = new Set((localIfaces[iface] || []).map((f) => f.name))
  const missing = need.filter((f) => !f.optional && !have.has(f.name)).map((f) => f.name)
  if (missing.length) block(`${iface} dropped required fields: ${missing.join(', ')}`)
  else ok(`${iface} required fields intact`)
}
if (house.role !== 'kattorepo' && localSrc && /SupportedSport/.test(canonicalSrc) && !/weather/.test(localSrc)) {
  advise('SupportedSport adapter has not yet widened to include "weather" (union lag, non-breaking).')
}

// 4. Local 5-point plans
const plansDir = join(ROOT, 'docs/plans')
if (existsSync(plansDir)) {
  const files = readdirSync(plansDir).filter(isPlanFile)
  if (files.length === 0) {
    advise('docs/plans/ has no PLAN/SPEC file. Add one with the 5-point test spec (TEST_PLAN_STANDARD.md).')
  } else {
    let any = false
    for (const f of files) {
      const text = readFileSync(join(plansDir, f), 'utf8')
      if (planHasFivePoint(text)) {
        ok(`Plan ${f} has 5-point test spec`)
        any = true
      } else {
        advise(`Plan ${f} missing 5-point spec (User Journey / When it succeeds / When it should fail).`)
      }
    }
    if (!any) advise('No local plan carries the 5-point spec — future work will drift. Copy TEST_PLAN_STANDARD.md.')
  }
}

// 5. Neighbors: GitHub rule + contracts + live
const targets = process.argv.includes('--all')
  ? Object.keys(graph.houses).filter((n) => n !== repo)
  : (house.needs || [])

for (const name of targets) {
  const n = graph.houses[name]
  if (!n) {
    block(`Neighbor "${name}" is not in the federation graph.`)
    continue
  }
  const branch = n.branch || 'main'
  const agents = await getGithubFile(name, branch, 'AGENTS.md')
  if (!agents.ok) {
    block(`Neighbor ${name} AGENTS.md unreachable (${agents.status}). House is not in line.`)
  } else {
    const words = agents.body.trim().split(/\s+/).length
    if (words > 1500) advise(`${name} AGENTS.md over cap (${words} words)`)
    const missingTokens = (graph.requiredRuleTokens || []).filter((t) => !new RegExp(t, 'i').test(agents.body))
    if (missingTokens.length) advise(`${name} AGENTS.md missing tokens: ${missingTokens.join(', ')}`)
    else ok(`${name} Rule present (${words} words)`)
  }

  if (n.provides?.length) {
    const paths = name === 'Parkkis'
      ? ['src/contracts.ts', 'web/src/lib/contracts.ts']
      : name === 'sports-federation'
        ? ['contracts/index.ts']
        : ['src/types/contracts.ts', 'src/contracts.ts']
    let found = ''
    for (const p of paths) {
      const r = await getGithubFile(name, branch, p)
      if (r.ok) { found = r.body; break }
    }
    if (!found) {
      advise(`${name} contracts adapter not fetchable from GitHub (check path).`)
    } else {
      const missing = n.provides.filter((i) => !found.includes(i))
      if (missing.length) block(`${name} GitHub adapter missing ${missing.join(', ')}`)
      else ok(`${name} provides ${n.provides.join(', ')}`)
    }
  }

  if (n.live) {
    const live = await getText(n.live)
    if (!live.ok) advise(`${name} live ${n.live} → HTTP ${live.status || live.error} (Cellarer / Pages)`)
    else if (!live.body.includes('id="root"') && !live.body.includes("id='root'") && name !== 'weather-stats') {
      advise(`${name} live HTML missing #root`)
    } else ok(`${name} live ${n.live} HTTP ${live.status}`)
  }
}

// 6. Own TASO / live
if (house.live) {
  const live = await getText(house.live)
  if (!live.ok) advise(`Own prod ${house.live} → HTTP ${live.status || live.error}`)
  else ok(`Own prod ${house.live} HTTP ${live.status}`)
}
if (house.taso) {
  const taso = await probeTaso(house.taso)
  if (taso.ok) ok(`TASO ${house.taso.sport} via ${taso.via}${taso.note ? ' (' + taso.note + ')' : ''}`)
  else advise(`TASO ${house.taso.sport} down (${taso.note || taso.status})`)
}

// 7. Chronicle
const visDir = join(ROOT, '.agent', 'visitations')
if (!existsSync(visDir)) mkdirSync(visDir, { recursive: true })
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
const report = {
  monastery: repo,
  at: new Date().toISOString(),
  blockers,
  advisories,
  oks,
}
writeFileSync(join(visDir, `neighbors-${stamp}.json`), JSON.stringify(report, null, 2))

console.log('')
console.log(`Neighbors: ${oks.length} ok · ${advisories.length} advisory · ${blockers.length} blocking`)
if (blockers.length) {
  console.error('\n❌ [NEIGHBORS] Blocking. Do not merge until houses are in line.')
  process.exit(1)
}
console.log('✨ [NEIGHBORS] Houses in line. Advisories belong to Cellarer / plans, not this commit.\n')
