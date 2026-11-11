import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contractUses, operations } = require('../dist/nodes/ContactZapp/contract.js');

const committed = readFileSync(new URL('../contract-uses.json', import.meta.url), 'utf8');

test('contract-uses.json is what the contract produces (run `npm run contract`)', () => {
	assert.equal(committed, `${JSON.stringify(contractUses(), null, 2)}\n`);
});

test('every operation is a call on the public API', () => {
	for (const [id, { method, path }] of Object.entries(operations)) {
		assert.match(path, /^\/api\/v1\//, id);
		assert.match(method, /^(GET|POST|PATCH|DELETE)$/, id);
	}
});

test('the package never deletes a contact', () => {
	for (const { method, path } of Object.values(operations)) {
		assert.ok(!(method === 'DELETE' && path.includes('/contacts')), path);
	}
});

test('contract-uses.json carries the signature rule the node relies on', () => {
	const { webhookSignature } = JSON.parse(committed);
	assert.deepEqual(webhookSignature, {
		header: 'ContactZapp-Signature',
		scheme: 'v1',
		format: 't=<unix seconds>,v1=<hex HMAC-SHA256>',
		toleranceSeconds: 300,
	});
});

test('changing the declared tolerance or header changes contract-uses.json', () => {
	const { contractUses, webhookSignature } = require('../dist/nodes/ContactZapp/contract.js');
	const before = JSON.stringify(contractUses());
	for (const [key, value] of [['toleranceSeconds', 60], ['header', 'X-Other']]) {
		const saved = webhookSignature[key];
		webhookSignature[key] = value;
		try {
			assert.notEqual(JSON.stringify(contractUses()), before, key);
		} finally {
			webhookSignature[key] = saved;
		}
	}
});
