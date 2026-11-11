import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sign, verifySignature, TOLERANCE_SECONDS } = require('../dist/nodes/ContactZapp/signature.js');
const { webhookSignature } = require('../dist/nodes/ContactZapp/contract.js');

const secret = 'cz_whsec_test-secret';
const rawBody = Buffer.from('{"id":"evt_1","event":"contact.created"}');
const now = 1_800_000_000;
const header = (t, body = rawBody, key = secret) => `t=${t},v1=${sign(key, String(t), body)}`;
const check = (overrides) => verifySignature({ header: header(now), rawBody, secret, nowSeconds: now, ...overrides });

test('a good signature is accepted', () => {
	assert.deepEqual(check({}), { ok: true });
});

test('the signature is the hex HMAC-SHA256 of the timestamp, a full stop and the raw body', () => {
	assert.equal(
		sign('key', '1700000000', '{"a":1}'),
		createHmac('sha256', 'key').update('1700000000.{"a":1}').digest('hex'),
	);
});

test('a bad signature is refused', () => {
	for (const bad of [
		{ header: header(now, rawBody, 'another-secret') },
		{ header: `t=${now},v1=${'0'.repeat(64)}` },
		{ header: `t=${now},v1=not-hex` },
		{ rawBody: Buffer.from('{"id":"evt_1","event":"contact.updated"}') },
		{ secret: 'another-secret' },
	]) {
		assert.deepEqual(check(bad), { ok: false, reason: 'bad_signature' });
	}
});

test('a missing secret or body is refused', () => {
	assert.equal(check({ secret: undefined }).ok, false);
	assert.equal(check({ secret: '' }).ok, false);
	assert.equal(check({ rawBody: undefined }).ok, false);
});

test('a timestamp more than five minutes from the clock is refused, in either direction', () => {
	assert.equal(TOLERANCE_SECONDS, 300);
	assert.deepEqual(check({ header: header(now - 301) }), { ok: false, reason: 'stale_timestamp' });
	assert.deepEqual(check({ header: header(now + 301) }), { ok: false, reason: 'stale_timestamp' });
	assert.deepEqual(check({ header: header(now - 300) }), { ok: true });
	assert.deepEqual(check({ header: header(now + 300) }), { ok: true });
});

test('a stale timestamp is refused even when the signature is good', () => {
	const old = now - 3600;
	assert.equal(verifySignature({ header: header(old), rawBody, secret, nowSeconds: now }).ok, false);
});

test('a missing header is refused', () => {
	assert.deepEqual(check({ header: undefined }), { ok: false, reason: 'missing_signature' });
	assert.deepEqual(check({ header: '' }), { ok: false, reason: 'missing_signature' });
});

test('a header without a timestamp or a signature is refused', () => {
	for (const malformed of ['garbage', `v1=${'a'.repeat(64)}`, `t=${now}`, `t=abc,v1=${'a'.repeat(64)}`, 't=,v1=']) {
		assert.deepEqual(check({ header: malformed }), { ok: false, reason: 'malformed_signature' }, malformed);
	}
});

test('any one of several v1 signatures may match', () => {
	const good = sign(secret, String(now), rawBody);
	assert.deepEqual(check({ header: `t=${now},v1=${'0'.repeat(64)},v1=${good}` }), { ok: true });
});

test('the tolerance is the one the contract table declares', () => {
	assert.equal(TOLERANCE_SECONDS, webhookSignature.toleranceSeconds);
	const edge = webhookSignature.toleranceSeconds;
	assert.deepEqual(check({ header: header(now - edge) }), { ok: true });
	assert.deepEqual(check({ header: header(now - edge - 1) }), { ok: false, reason: 'stale_timestamp' });
});

test('the header format the contract table declares is the one the node reads', () => {
	assert.equal(webhookSignature.header, 'ContactZapp-Signature');
	assert.equal(webhookSignature.format, `t=<unix seconds>,${webhookSignature.scheme}=<hex HMAC-SHA256>`);
	// Written from the declared scheme: a different scheme key is not a signature this node reads.
	const good = sign(secret, String(now), rawBody);
	assert.deepEqual(check({ header: `t=${now},${webhookSignature.scheme}=${good}` }), { ok: true });
	assert.deepEqual(check({ header: `t=${now},v2=${good}` }), { ok: false, reason: 'malformed_signature' });
});
