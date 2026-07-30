import { access, cp, mkdir } from 'node:fs/promises';

const assetGroups = [
  {
    source: new URL('../../contract/src/managed/aequira/keys/', import.meta.url),
    target: new URL('../public/keys/', import.meta.url),
  },
  {
    source: new URL('../../contract/src/managed/aequira/zkir/', import.meta.url),
    target: new URL('../public/zkir/', import.meta.url),
  },
];

for (const { source, target } of assetGroups) {
  await access(source);
  await mkdir(target, { recursive: true });
  await cp(source, target, {
    dereference: true,
    force: true,
    recursive: true,
  });
}

console.log(`Prepared ${assetGroups.length} generated ZK asset groups for the browser build.`);
