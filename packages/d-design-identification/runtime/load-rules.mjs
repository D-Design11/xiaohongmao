/** Local server/development loader. Does not call AI or access a network. */
import { readFile } from 'node:fs/promises';
import { materializeBundle } from './components.mjs';
import { assertRules } from './extreme.mjs';

export async function loadBundle(root = new URL('../', import.meta.url)) {
  const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const [regular, extreme, common, assets] = await Promise.all([
    json('rules/regular.json'), json('rules/extreme.json'), json('rules/common.json'),
    json('references/asset-bindings.json')
  ]);
  const bundle = materializeBundle({ regular, extreme, common, assets });
  assertRules(bundle.rules, bundle.common);
  return bundle;
}
