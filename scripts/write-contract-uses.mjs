// Writes contract-uses.json from the compiled contract (run `npm run build` first), or with
// --check fails when the committed file is not what the contract produces.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contractUses } = require('../dist/nodes/ContactZapp/contract.js');

const target = fileURLToPath(new URL('../contract-uses.json', import.meta.url));
const wanted = `${JSON.stringify(contractUses(), null, 2)}\n`;

if (process.argv.includes('--check')) {
	if (readFileSync(target, 'utf8') !== wanted) {
		console.error('contract-uses.json is out of date. Run `npm run contract` and commit it.');
		process.exit(1);
	}
} else {
	writeFileSync(target, wanted);
}
