#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { loadBundle } from '../runtime/load-rules.mjs';
import { resolveConstraints } from '../runtime/extreme.mjs';
try {
  if (!process.argv[2]) throw new Error('用法：node development/resolve.mjs <request.json>');
  const bundle = await loadBundle();
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = resolveConstraints(input, bundle.rules, bundle.common);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 2;
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
