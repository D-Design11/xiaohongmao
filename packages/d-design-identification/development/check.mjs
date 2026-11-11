#!/usr/bin/env node
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { loadBundle } from '../runtime/load-rules.mjs';
import { resolveConstraints } from '../runtime/extreme.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJSON = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const save = async (path, data) => writeFile(resolve(root, path), JSON.stringify(data, null, 2) + '\n');
const refresh = process.argv.includes('--refresh-manifest');
async function files(dir = root) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.DS_Store', '__MACOSX', '__pycache__'].includes(entry.name)) continue;
    const p = resolve(dir, entry.name), name = relative(root, p).split(sep).join('/');
    if (name === 'development/results') continue;
    if (entry.isDirectory()) result.push(...await files(p));
    else if (entry.isFile()) result.push(name);
    else throw new Error('规则包不能包含符号链接或设备文件。');
  }
  return result.sort();
}
await mkdir(resolve(root, 'development/results'), { recursive: true });
const checks = [], failures = [];
try {
  const rawCommon = await readFile(resolve(root, 'rules/common.json'));
  const commonSha = sha(rawCommon);
  if (refresh) {
    const regular = await readJSON('rules/regular.json');
    const extreme = await readJSON('rules/extreme.json');
    regular.shared_component_dependency = { file: 'rules/common.json', version: JSON.parse(rawCommon).version, sha256: commonSha };
    extreme.sources['common-shared'].sha256 = commonSha;
    await save('rules/regular.json', regular); await save('rules/extreme.json', extreme);
  }
  const bundle = await loadBundle();
  if (bundle.definitions.regular.shared_component_dependency?.sha256 !== commonSha || bundle.rules.sources['common-shared'].sha256 !== commonSha) throw new Error('共用参数依赖摘要不一致。');
  if (JSON.stringify(['S','M','L'].map(p => bundle.regular.copy_limits[p].title_max_graphemes)) !== '[10,12,14]' || Object.values(bundle.regular.copy_limits).some(p => p.subtitle_max_graphemes !== 18 || JSON.stringify(p.wrap_threshold_applies_to) !== '["subtitle"]')) throw new Error('常规字数或副标题断行范围不一致。');
  if (bundle.regular.units.text_capacity_reference_width !== 1200 || bundle.common.typography.referenceTextWidth !== 1600) throw new Error('两个模块的候选文字容量被意外合并。');
  checks.push('shared parameters, module overrides and copy limits');
  const skill = await readFile(resolve(root, 'SKILL.md'), 'utf8');
  if (!skill.startsWith('---\nname: d-design-identification\n') || skill.includes('[TODO:')) throw new Error('Skill入口不完整。');
  checks.push('skill entrypoint');
  for (const orientation of ['landscape', 'portrait']) {
    const input = await readJSON(`development/examples/${orientation}.request.json`);
    const plan = resolveConstraints(input, bundle.rules, bundle.common);
    if (!plan.ok) throw new Error('极端示例几何无法计算。');
    const output = `development/results/${orientation}.constraints.json`;
    if (refresh) await save(output, plan);
    else {
      // Output is disposable. Recreate it, then read it to check serializability.
      await save(output, plan);
      if (!isDeepStrictEqual(await readJSON(output), plan)) throw new Error('生成约束不能完整序列化。');
    }
  }
  checks.push('recomputed extreme examples');
  const paths = (await files()).filter(p => p !== 'manifest.json');
  for (const path of paths.filter(p => p.endsWith('.json'))) await readJSON(path);
  for (const path of paths.filter(p => p.endsWith('.md'))) {
    const source = await readFile(resolve(root, path), 'utf8');
    for (const match of source.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
      await readFile(resolve(root, path, '..', target));
    }
  }
  checks.push('JSON syntax and local Markdown links');
  const entries = await Promise.all(paths.map(async path => { const bytes = await readFile(resolve(root, path)); return { path, bytes: bytes.byteLength, sha256: sha(bytes) }; }));
  if (refresh) await save('manifest.json', {
    id: 'd-design-identification-bundle', version: '1.1.0', runtimeApiVersion: 2,
    date: '2026-11-11', status: 'reorganized-candidate-rules-not-a-production-release',
    entrypoints: { common: 'rules/common.json', regular: 'rules/regular.json', extreme: 'rules/extreme.json', assets: 'references/asset-bindings.json', skill: 'SKILL.md', runtime: 'runtime/load-rules.mjs' },
    moduleVersions: { common: bundle.definitions.common.version, regular: bundle.regular.version, extreme: bundle.rules.version },
    originalPackagesUnchanged: true, actualBinaryAssetsIncluded: false,
    excludedFromIntegrity: ['manifest.json', 'development/results/**', '**/.DS_Store', '**/__pycache__/**'],
    files: entries
  });
  const manifest = await readJSON('manifest.json');
  if (manifest.runtimeApiVersion !== 2 || !isDeepStrictEqual(manifest.files, entries)) throw new Error('文件清单不匹配，请审阅修改后刷新manifest。');
  checks.push(`file integrity: ${entries.length} files`);
} catch (error) { failures.push(error.message); }
const report = { ok: !failures.length, checkedAt: new Date().toISOString(), checks, failures,
  notVerified: ['real AI semantic line breaks', 'website integration', 'brand approval', 'production file output', 'live GitHub fetch'] };
await save('development/results/package-check.json', report);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (failures.length) process.exitCode = 1;
