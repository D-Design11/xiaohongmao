/** Optional pinned data loader. Deploy runtime code with the application. */
import { assertRules } from '../../runtime/extreme.mjs';
import { materializeBundle } from '../../runtime/components.mjs';
const digest = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
async function readBounded(url, fetcher, maxBytes = 200000) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000), headers: { Accept: 'text/plain, application/json' } });
  if (!response.ok) throw new Error(`规则文件读取失败：HTTP ${response.status}`);
  const stream = response.body?.getReader();
  if (!stream) throw new Error('响应没有可读取正文。');
  const chunks = []; let total = 0;
  while (true) {
    const { value, done } = await stream.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await stream.cancel(); throw new Error('规则文件超过大小限制。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function loadGithubBundle(commit, { fetcher = fetch, repository = 'D-Design11/xiaohongmao' } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('请传入固定的40位Git提交SHA，不能传main或latest。');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('仓库名称格式不正确。');
  const root = `https://raw.githubusercontent.com/${repository}/${commit}/packages/d-design-identification/`;
  const manifest = JSON.parse(new TextDecoder().decode(await readBounded(root + 'manifest.json', fetcher)));
  if (manifest.id !== 'd-design-identification-bundle' || manifest.runtimeApiVersion !== 2 || !['1.1.0','1.2.0'].includes(manifest.version) || !Array.isArray(manifest.files)) throw new Error('规则包或运行时版本不兼容；先升级并验证后台模块。');
  const paths = ['rules/regular.json', 'rules/extreme.json', 'rules/common.json', 'references/asset-bindings.json', 'SKILL.md'];
  if(manifest.version==='1.2.0')paths.push('rules/image-extension.json','references/approved-image-extensions.json');
  const contents = await Promise.all(paths.map(async path => {
    const entry = manifest.files.find(f => f.path === path);
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 200000) throw new Error('清单缺少有效文件摘要。');
    const bytes = await readBounded(root + path, fetcher);
    if (bytes.byteLength !== entry.bytes || await digest(bytes) !== entry.sha256) throw new Error(`规则文件摘要不匹配：${path}`);
    return new TextDecoder().decode(bytes);
  }));
  const [regular, extreme, common, assets] = contents.slice(0, 4).map(v => JSON.parse(v));
  if (await digest(new TextEncoder().encode(contents[2])) !== extreme.sources['common-shared'].sha256) throw new Error('共用组件与极端规则依赖不一致。');
  if (await digest(new TextEncoder().encode(contents[2])) !== regular.shared_component_dependency.sha256) throw new Error('共用组件与常规规则依赖不一致。');
  const bundle = materializeBundle({ regular, extreme, common, assets, ...(contents[5]?{imageExtension:JSON.parse(contents[5]),approvedImageExtensions:JSON.parse(contents[6])}:{}), skillText: contents[4],
    provenance: { repository, commit, bundleVersion: manifest.version, files: paths.map(path => manifest.files.find(f => f.path === path)) } });
  assertRules(bundle.rules, bundle.common);
  return bundle;
}
