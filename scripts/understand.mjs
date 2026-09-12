#!/usr/bin/env node
/**
 * Federation Understand pipeline
 *
 * Compatible with Egonex Understand-Anything `.ua/knowledge-graph.json` (v1.0.0).
 * Deterministic structural pass (no LLM): files, exports, imports, workflows,
 * contracts, docs, domain graph from federation.neighbors.json.
 *
 * Usage: node scripts/understand.mjs           # this repo
 *        node scripts/understand.mjs --all     # sibling houses (federation)
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const UA_DIR = join(ROOT, '.ua')
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', '.wrangler', 'coverage', '.ua', '.agent', 'artifacts'])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const DOC_EXT = new Set(['.md'])
const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'vite.config.ts', 'wrangler.toml', 'wrangler.jsonc', 'lefthook.yml', 'eslint.config.js', 'federation.neighbors.json'])

function detectRepo() {
  try {
    const url = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim()
    const m = url.match(/github\.com[:/][^/]+\/([^/.]+)(?:\.git)?$/i)
    if (m) return m[1]
  } catch { /* */ }
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name } catch { return 'unknown' }
}

function gitCommit() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '' }
}

function walk(dir, acc = []) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue
    if (SKIP_DIR.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

function layerOf(rel) {
  const p = rel.replace(/\\/g, '/')
  if (p.includes('.github/workflows')) return 'ci'
  if (/(^|\/)(docs|AGENTS\.md|ROLL\.md|llms\.txt)/.test(p)) return 'docs'
  if (p.includes('contracts') || p.includes('types/contracts')) return 'contract'
  if (p.includes('workers') || p.includes('wrangler') || p.includes('cloudflare')) return 'edge'
  if (/(^|\/)(pages|components|ui)\//.test(p) || p.endsWith('.tsx')) return 'ui'
  if (/(services|lib\/api|lib\/ssbl)\//.test(p)) return 'service'
  if (p.includes('scripts/')) return 'tooling'
  if (CONFIG_NAMES.has(p.split('/').pop())) return 'config'
  return 'app'
}

function complexityOf(text) {
  const n = text.split('\n').length
  if (n < 80) return 'simple'
  if (n < 250) return 'moderate'
  return 'complex'
}

function firstSentence(text) {
  const body = text.replace(/^[\s\S]*?(?:\*\/|(?:^|\n)(?![\s/*]))/, '').replace(/^#+\s+/m, '')
  const line = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('*') && !l.startsWith('/') && !l.startsWith('import') && !l.startsWith('export') && !l.startsWith('{'))
  return (line || '').slice(0, 180)
}

function parseExports(text, rel) {
  const out = []
  const reFn = /export\s+(?:async\s+)?function\s+(\w+)/g
  const reCl = /export\s+(?:abstract\s+)?class\s+(\w+)/g
  const reIf = /export\s+interface\s+(\w+)/g
  const reTy = /export\s+type\s+(\w+)/g
  const reCst = /export\s+(?:const|let)\s+(\w+)/g
  let m
  while ((m = reFn.exec(text))) out.push({ kind: 'function', name: m[1], line: text.slice(0, m.index).split('\n').length })
  while ((m = reCl.exec(text))) out.push({ kind: 'class', name: m[1], line: text.slice(0, m.index).split('\n').length })
  while ((m = reIf.exec(text))) out.push({ kind: 'class', name: m[1], line: text.slice(0, m.index).split('\n').length })
  while ((m = reTy.exec(text))) out.push({ kind: 'class', name: m[1], line: text.slice(0, m.index).split('\n').length })
  while ((m = reCst.exec(text))) {
    if (/^[A-Z]/.test(m[1]) || m[1].endsWith('Contract')) {
      out.push({ kind: 'function', name: m[1], line: text.slice(0, m.index).split('\n').length })
    }
  }
  return out.map((x) => ({ ...x, id: `${x.kind === 'function' ? 'function' : 'class'}:${rel}:${x.name}` }))
}

function parseImports(text, rel, fileSet) {
  const edges = []
  const re = /import\s+(?:type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(text))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    const resolved = resolveImport(rel, spec, fileSet)
    if (resolved) edges.push({ source: `file:${rel}`, target: `file:${resolved}`, type: 'imports', direction: 'forward', weight: 0.8 })
  }
  return edges
}

function resolveImport(fromRel, spec, fileSet) {
  const dir = dirname(fromRel)
  const raw = join(dir, spec).replace(/\\/g, '/').replace(/^\.\//, '')
  const candidates = [raw, raw + '.ts', raw + '.tsx', raw + '.js', raw + '.mjs', raw + '/index.ts', raw + '/index.tsx']
  return candidates.find((c) => fileSet.has(c) || fileSet.has(c.replace(/\\/g, '/')))
}

function node({ id, type, name, filePath, line, summary, tags, complexity, languageNotes }) {
  const n = { id, type, name, summary: summary || name, tags: tags || [], complexity: complexity || 'simple' }
  if (filePath) n.filePath = filePath
  if (line) n.lineRange = [line, line]
  if (languageNotes) n.languageNotes = languageNotes
  return n
}

function buildGraph(repo) {
  const files = walk(ROOT).map((abs) => ({ abs, rel: relative(ROOT, abs).replace(/\\/g, '/') }))
  const fileSet = new Set(files.map((f) => f.rel))
  const nodes = []
  const edges = []
  const byLayer = {}
  const pkg = existsSync(join(ROOT, 'package.json')) ? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) : {}

  const languages = new Set()
  const frameworks = new Set()
  if (pkg.dependencies?.react || pkg.devDependencies?.react) frameworks.add('react')
  if (pkg.devDependencies?.vite || pkg.dependencies?.vite) frameworks.add('vite')
  if (pkg.devDependencies?.vitest) frameworks.add('vitest')
  if (existsSync(join(ROOT, 'wrangler.toml')) || existsSync(join(ROOT, 'workers'))) frameworks.add('cloudflare-workers')

  for (const { abs, rel } of files) {
    const ext = extname(rel)
    const base = rel.split('/').pop()
    let text = ''
    try { text = readFileSync(abs, 'utf8') } catch { continue }
    const layer = layerOf(rel)
    byLayer[layer] ||= []
    const cx = complexityOf(text)
    const summary = firstSentence(text) || rel

    if (CODE_EXT.has(ext)) {
      if (ext.includes('ts')) languages.add('typescript')
      else languages.add('javascript')
      const id = `file:${rel}`
      nodes.push(node({ id, type: 'file', name: base, filePath: rel, summary, tags: [layer], complexity: cx }))
      byLayer[layer].push(id)
      const exports = parseExports(text, rel)
      for (const ex of exports) {
        nodes.push(node({
          id: ex.id,
          type: ex.kind === 'function' ? 'function' : 'class',
          name: ex.name,
          filePath: rel,
          line: ex.line,
          summary: `${ex.kind} ${ex.name} in ${rel}`,
          tags: [layer, ex.kind],
          complexity: 'simple',
        }))
        edges.push({ source: id, target: ex.id, type: 'contains', direction: 'forward', weight: 1 })
        byLayer[layer].push(ex.id)
      }
      edges.push(...parseImports(text, rel, fileSet))
      if (/fetch\(|tasoGet|ssblFetch|torneopal/i.test(text)) {
        const eid = `endpoint:${rel}:taso`
        if (!nodes.some((n) => n.id === eid)) {
          nodes.push(node({ id: eid, type: 'endpoint', name: 'Torneopal/TASO', filePath: rel, summary: 'Association REST client', tags: ['taso', layer], complexity: 'moderate' }))
          edges.push({ source: id, target: eid, type: 'calls', direction: 'forward', weight: 0.7 })
        }
      }
    } else if (DOC_EXT.has(ext) || rel === 'AGENTS.md' || rel === 'ROLL.md' || rel === 'llms.txt') {
      const id = `document:${rel}`
      nodes.push(node({ id, type: 'document', name: base, filePath: rel, summary, tags: ['docs'], complexity: cx }))
      byLayer.docs ||= []
      byLayer.docs.push(id)
    } else if (CONFIG_NAMES.has(base) || rel.endsWith('.toml') || rel.endsWith('.yml') && !rel.includes('.github')) {
      const id = `config:${rel}`
      nodes.push(node({ id, type: 'config', name: base, filePath: rel, summary: `Config ${base}`, tags: ['config'], complexity: 'simple' }))
      byLayer.config ||= []
      byLayer.config.push(id)
    } else if (rel.includes('.github/workflows/') && (rel.endsWith('.yml') || rel.endsWith('.yaml'))) {
      const id = `pipeline:${rel}`
      nodes.push(node({ id, type: 'pipeline', name: base, filePath: rel, summary: 'CI/CD workflow', tags: ['ci'], complexity: 'simple' }))
      byLayer.ci ||= []
      byLayer.ci.push(id)
      edges.push({ source: id, target: `document:AGENTS.md`, type: 'triggers', direction: 'forward', weight: 0.4 })
    }
  }

  // Treaty / neighbor concepts
  const agents = existsSync(join(ROOT, 'AGENTS.md')) ? readFileSync(join(ROOT, 'AGENTS.md'), 'utf8') : ''
  if (agents) {
    nodes.push(node({ id: 'concept:the-rule', type: 'concept', name: 'The Rule (AGENTS.md)', summary: 'Supreme house rule, <1500 words', tags: ['governance'], complexity: 'simple', filePath: 'AGENTS.md' }))
    edges.push({ source: 'document:AGENTS.md', target: 'concept:the-rule', type: 'documents', direction: 'forward', weight: 1 })
  }
  if (existsSync(join(ROOT, 'federation.neighbors.json')) || existsSync(join(ROOT, 'contracts/neighbors.json'))) {
    nodes.push(node({ id: 'concept:chapter-of-neighbors', type: 'concept', name: 'Chapter of Neighbors', summary: 'Visit-gate that freezes contracts and peer AGENTS.md', tags: ['governance', 'treaty'], complexity: 'moderate' }))
  }

  const graphPath = existsSync(join(ROOT, 'contracts/index.ts')) ? 'contracts/index.ts' : (existsSync(join(ROOT, 'src/types/contracts.ts')) ? 'src/types/contracts.ts' : (existsSync(join(ROOT, 'src/contracts.ts')) ? 'src/contracts.ts' : null))
  if (graphPath) {
    nodes.push(node({ id: `schema:${graphPath}`, type: 'schema', name: 'Federation contracts', filePath: graphPath, summary: 'Canonical v1.0.0 treaty adapters', tags: ['treaty'], complexity: 'moderate' }))
    edges.push({ source: `file:${graphPath}`, target: `schema:${graphPath}`, type: 'defines_schema', direction: 'forward', weight: 1 })
  }

  const layers = Object.entries(byLayer).map(([id, nodeIds]) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    description: `${id} layer`,
    nodeIds: [...new Set(nodeIds)],
  }))

  const tour = [
    existsSync(join(ROOT, 'AGENTS.md')) && { order: 1, title: 'The Rule', description: 'Read AGENTS.md before changing code.', nodeIds: ['document:AGENTS.md', 'concept:the-rule'].filter((id) => nodes.some((n) => n.id === id)) },
    graphPath && { order: 2, title: 'Treaty', description: 'Contract fields this house must keep.', nodeIds: [`schema:${graphPath}`] },
    { order: 3, title: 'Services', description: 'API clients and TASO cache policy.', nodeIds: nodes.filter((n) => n.tags?.includes('service') || n.type === 'endpoint').slice(0, 8).map((n) => n.id) },
    { order: 4, title: 'UI', description: 'Pages the family actually opens.', nodeIds: nodes.filter((n) => n.tags?.includes('ui') && n.type === 'file').slice(0, 8).map((n) => n.id) },
    { order: 5, title: 'Visit gate', description: 'npm run visit + check-neighbors.mjs', nodeIds: nodes.filter((n) => n.filePath && n.filePath.includes('check-neighbors')).map((n) => n.id) },
  ].filter((s) => s && s.nodeIds?.length)

  // Drop dangling edges
  const ids = new Set(nodes.map((n) => n.id))
  const cleanEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))

  return {
    version: '1.0.0',
    kind: 'codebase',
    project: {
      name: repo,
      languages: [...languages],
      frameworks: [...frameworks],
      description: pkg.description || `Monastery ${repo}`,
      analyzedAt: new Date().toISOString(),
      gitCommitHash: gitCommit(),
    },
    nodes,
    edges: cleanEdges,
    layers,
    tour,
  }
}

function buildDomain(repo, graph) {
  const nodes = []
  const edges = []
  const neighborsPath = existsSync(join(ROOT, 'federation.neighbors.json'))
    ? join(ROOT, 'federation.neighbors.json')
    : existsSync(join(ROOT, 'contracts/neighbors.json'))
      ? join(ROOT, 'contracts/neighbors.json')
      : null
  const graphJson = neighborsPath ? JSON.parse(readFileSync(neighborsPath, 'utf8')) : null
  const house = graphJson?.houses?.[repo]

  nodes.push({ id: `domain:${repo}`, type: 'domain', name: repo, summary: `House ${repo}`, tags: ['house'], complexity: 'moderate' })

  const flows = [
    { id: 'flow:matchday', name: 'Saturday matchday', steps: ['ingest-schedule', 'detect-conflict', 'open-stats', 'park-and-weather'] },
    { id: 'flow:taso-cache', name: 'Torneopal cache', steps: ['classify-live-upcoming-played', 'no-store-live', 'short-upcoming', 'immutable-played'] },
    { id: 'flow:visitation', name: 'Chapter of Neighbors', steps: ['lint-test', 'contract-freeze', 'peer-agents', '5-point-plans'] },
  ]
  for (const f of flows) {
    nodes.push({ id: f.id, type: 'flow', name: f.name, summary: f.name, tags: ['flow'], complexity: 'moderate' })
    edges.push({ source: `domain:${repo}`, target: f.id, type: 'contains_flow', direction: 'forward', weight: 1 })
    f.steps.forEach((s, i) => {
      const id = `step:${f.id.replace('flow:', '')}:${s}`
      nodes.push({ id, type: 'step', name: s, summary: s, tags: ['step'], complexity: 'simple' })
      edges.push({ source: f.id, target: id, type: 'flow_step', direction: 'forward', weight: 1 - i * 0.05 })
    })
  }

  if (house?.needs) {
    for (const n of house.needs) {
      nodes.push({ id: `domain:${n}`, type: 'domain', name: n, summary: `Peer monastery ${n}`, tags: ['peer'], complexity: 'simple' })
      edges.push({ source: `domain:${repo}`, target: `domain:${n}`, type: 'depends_on', direction: 'forward', weight: 0.9 })
    }
  }

  return {
    version: '1.0.0',
    kind: 'knowledge',
    project: graph.project,
    nodes,
    edges,
    layers: [{ id: 'domain', name: 'Domain', description: 'Business flows', nodeIds: nodes.map((n) => n.id) }],
    tour: [
      { order: 1, title: 'This house', description: repo, nodeIds: [`domain:${repo}`] },
      { order: 2, title: 'Matchday', description: 'Family Saturday path', nodeIds: ['flow:matchday'] },
      { order: 3, title: 'Cache & visit', description: 'Live/upcoming cache + neighbor gate', nodeIds: ['flow:taso-cache', 'flow:visitation'] },
    ],
  }
}

const repo = detectRepo()
mkdirSync(UA_DIR, { recursive: true })
mkdirSync(join(UA_DIR, 'intermediate'), { recursive: true })

const graph = buildGraph(repo)
const domain = buildDomain(repo, graph)
const meta = {
  tool: 'federation-understand',
  compatibleWith: 'Egonex-AI/Understand-Anything 1.0.0',
  generatedAt: new Date().toISOString(),
  repo,
  commit: graph.project.gitCommitHash,
  nodeCount: graph.nodes.length,
  edgeCount: graph.edges.length,
}

writeFileSync(join(UA_DIR, 'knowledge-graph.json'), JSON.stringify(graph, null, 2))
writeFileSync(join(UA_DIR, 'domain-graph.json'), JSON.stringify(domain, null, 2))
writeFileSync(join(UA_DIR, 'meta.json'), JSON.stringify(meta, null, 2))
writeFileSync(join(UA_DIR, 'README.md'), `# Understand — ${repo}

Generated by \`scripts/understand.mjs\` in the [Understand Anything](https://github.com/Egonex-AI/Understand-Anything) schema.

- \`knowledge-graph.json\` — files, exports, imports, CI, contracts
- \`domain-graph.json\` — matchday / TASO cache / visitation flows + peer houses
- \`meta.json\` — counts and commit

Open with UA dashboard, or \`jq '.nodes[] | {id,type,name}' .ua/knowledge-graph.json\`.

Do not commit \`intermediate/\`.
`)

console.log(`🧠 Understand ${repo}: ${graph.nodes.length} nodes, ${graph.edges.length} edges → .ua/`)
