import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadGithubBundle } from '../integration/github-loader.mjs';
import { resolveProjectMaterial } from '../integration/project-adapter.mjs';
const root = new URL('../../', import.meta.url);
const commit = 'a'.repeat(40);
const prefix = `https://raw.githubusercontent.com/D-Design11/didi-design-rules/${commit}/packages/d-design-identification/`;
const read = path => readFile(new URL(path, root));
const hash = value => createHash('sha256').update(value).digest('hex');
function fakeFetcher(changes = {}, visited = []) {
  return async url => {
    assert.ok(url.startsWith(prefix));
    visited.push(url);
    const path = url.slice(prefix.length);
    const value = Object.hasOwn(changes, path) ? changes[path] : await read(path);
    return new Response(value, { status: 200 });
  };
}
test('GitHub loader verifies pinned five-file bundle with no real network calls', async () => {
  const visited = [];
  const bundle = await loadGithubBundle(commit, { fetcher: fakeFetcher({}, visited) });
  assert.equal(bundle.rules.content.headline.maxGraphemes, 10);
  assert.equal(bundle.common.marginInBrandUnits, 1);
  assert.equal(bundle.provenance.commit, commit);
  assert.equal(bundle.provenance.files.length, 5);
  assert.ok(bundle.skillText.includes('d-design-identification'));
  assert.equal(visited.length, 6);
});
test('loader rejects branch names and malformed repo before any fetch', async () => {
  const fetcher = async () => { assert.fail('must not fetch'); };
  for (const value of ['main', 'latest', '', 'abc']) await assert.rejects(loadGithubBundle(value, { fetcher }));
  await assert.rejects(loadGithubBundle(commit, { repository: '../../anything', fetcher }));
});
test('loader rejects altered content and oversize stream', async () => {
  const original = await read('rules/extreme.json');
  await assert.rejects(loadGithubBundle(commit, { fetcher: fakeFetcher({ 'rules/extreme.json': Buffer.concat([original, Buffer.from(' ')]) }) }), /摘要不匹配/);
  await assert.rejects(loadGithubBundle(commit, { fetcher: async () => new Response('X'.repeat(200001)) }), /大小限制/);
});
test('loader catches a mixed common snapshot even when its manifest digest is replaced', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  const common = JSON.parse(await read('rules/common.json')); common.marginInBrandUnits = 1.1;
  const bytes = Buffer.from(JSON.stringify(common));
  const entry = manifest.files.find(f => f.path === 'rules/common.json');
  entry.sha256 = hash(bytes); entry.bytes = bytes.byteLength;
  await assert.rejects(loadGithubBundle(commit, { fetcher: fakeFetcher({ 'manifest.json': JSON.stringify(manifest), 'rules/common.json': bytes }) }), /依赖不一致/);
});
test('adapter drops legacy QR input from material render without mutating the project', async () => {
  const bundle = await loadGithubBundle(commit, { fetcher: fakeFetcher() });
  const project = { title: '杭州周末出发', subtitle: '滴滴打车福利', url: 'https://example.com/activity', splitPreset: 'M' };
  const before = JSON.stringify(project);
  const result = resolveProjectMaterial(project, { w: 6000, h: 1000, unit: 'px' }, bundle);
  assert.equal(result.route, 'extreme-supported'); assert.equal(result.ok, true);
  assert.equal(result.qr, null); assert.equal(result.qrReservedSpace, 0);
  assert.equal(result.notes.length, 1); assert.equal(JSON.stringify(project), before);
});
test('adapter routes regular and unsupported extreme dimensions separately', async () => {
  const bundle = await loadGithubBundle(commit, { fetcher: fakeFetcher() });
  const project = { title: '杭州出发', subtitle: '' };
  assert.equal(resolveProjectMaterial(project, { w: 1920, h: 1080, unit: 'px' }, bundle).route, 'regular');
  const unsupported = resolveProjectMaterial(project, { w: 1000, h: 4000, unit: 'px' }, bundle);
  assert.equal(unsupported.route, 'extreme-unsupported'); assert.equal(unsupported.ok, false);
});
