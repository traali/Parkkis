import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wf = (n) => readFileSync(join(ROOT, '.github/workflows', n), 'utf8');

describe('a data commit can never leave prod empty', () => {
  it('ingest deploys via cd.yml after it commits', () => {
    assert.match(wf('ingest.yml'), /committed=true/);
    assert.match(wf('ingest.yml'), /uses: \.\/\.github\/workflows\/cd\.yml/);
  });
  it('cd.yml is callable, builds master, refuses an empty dist and verifies prod', () => {
    const cd = wf('cd.yml');
    assert.match(cd, /workflow_call:/);
    assert.match(cd, /ref: master/);
    assert.match(cd, /Refuse to publish an empty site/);
    assert.match(cd, /Verify production/);
  });
  it('hourly health check redeploys when / or a venue link is down', () => {
    const h = wf('health.yml');
    assert.match(h, /cron: '17 \* \* \* \*'/);
    assert.match(h, /\/venue\//);
    assert.match(h, /uses: \.\/\.github\/workflows\/cd\.yml/);
  });
});
