import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ContactZapp } = require('../dist/nodes/ContactZapp/ContactZapp.node.js');
const { ContactZappTrigger } = require('../dist/nodes/ContactZapp/ContactZappTrigger.node.js');
const { sign } = require('../dist/nodes/ContactZapp/signature.js');

const node = { name: 'ContactZapp', type: 'n8n-nodes-contactzapp.contactZapp', typeVersion: 1, parameters: {} };
const BASE = 'https://app.example.test';

/** A fake n8n context. `replies` are answered in order; a function reply is called with the options. */
function fakeContext({ parameters = {}, replies = [], items = [{ json: {} }], continueOnFail = false, staticData = {} } = {}) {
	const sent = [];
	const context = {
		sent,
		staticData,
		getNode: () => node,
		getInputData: () => items,
		continueOnFail: () => continueOnFail,
		getNodeParameter: (name, _index, fallback) => (name in parameters ? parameters[name] : fallback),
		getCredentials: async () => ({ apiKey: 'cz_live_SECRET', baseUrl: `${BASE}/` }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.test/webhook/abc/webhook',
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				sent.push({ credential, ...options });
				const reply = replies.shift();
				if (reply instanceof Error) throw reply;
				return typeof reply === 'function' ? reply(options) : reply;
			},
			returnJsonArray: (body) => [{ json: body }],
		},
	};
	return context;
}

const failure = (status, body) =>
	Object.assign(new Error(`Request failed with status code ${status}`), {
		httpCode: String(status),
		response: { status, body },
		// A raw HTTP error carries the request, with the key in its headers.
		config: { headers: { Authorization: 'Bearer cz_live_SECRET' } },
	});

test('Contact Get Many with Return All follows nextCursor until the last page', async () => {
	const page = (ids, nextCursor) => ({ contacts: ids.map((id) => ({ id, emails: [], phones: [] })), nextCursor });
	const context = fakeContext({
		parameters: { resource: 'contact', operation: 'getAll', returnAll: true, simplify: false, filters: { email: 'a@b.c' } },
		replies: [page(['1', '2'], 'c2'), page(['3'], undefined)],
	});
	const [out] = await new ContactZapp().execute.call(context);
	assert.deepEqual(out.map((item) => item.json.id), ['1', '2', '3']);
	assert.equal(context.sent.length, 2);
	assert.equal(context.sent[0].url, `${BASE}/api/v1/contacts`);
	assert.deepEqual(context.sent[0].qs, { email: 'a@b.c', limit: 200 });
	assert.deepEqual(context.sent[1].qs, { email: 'a@b.c', limit: 200, cursor: 'c2' });
	assert.equal(context.sent[0].credential, 'contactZappApi');
});

test('Contact Get Many with a limit stops at the limit', async () => {
	const context = fakeContext({
		parameters: { resource: 'contact', operation: 'getAll', returnAll: false, limit: 2, simplify: true },
		replies: [{ contacts: [{ id: '1' }, { id: '2' }, { id: '3' }], nextCursor: 'more' }],
	});
	const [out] = await new ContactZapp().execute.call(context);
	assert.equal(out.length, 2);
	assert.equal(context.sent.length, 1);
	assert.equal(context.sent[0].qs.limit, 2);
	assert.equal(out[0].json.displayName, undefined);
	assert.ok('email' in out[0].json);
});

test('Contact Create sends the body and returns the API result', async () => {
	const result = { outcome: 'created', contact: { id: 'c1' } };
	const context = fakeContext({
		parameters: { resource: 'contact', operation: 'create', fields: { firstName: 'Ada' } },
		replies: [result],
	});
	const [out] = await new ContactZapp().execute.call(context);
	assert.deepEqual(out[0].json, result);
	assert.equal(context.sent[0].method, 'POST');
	assert.deepEqual(context.sent[0].body, { firstName: 'Ada' });
	assert.deepEqual(out[0].pairedItem, { item: 0 });
});

test('an API failure becomes a NodeApiError with the API message, its code and the item index, and no key', async () => {
	const context = fakeContext({
		parameters: { resource: 'contact', operation: 'create', fields: { firstName: 'Ada' } },
		replies: [failure(400, { code: 'unknown_field', message: 'The body has a field a contact does not take: id.' })],
	});
	await assert.rejects(new ContactZapp().execute.call(context), (error) => {
		assert.equal(error.name, 'NodeApiError');
		assert.equal(error.message, 'The body has a field a contact does not take: id.');
		assert.match(String(error.description), /unknown_field/);
		assert.equal(String(error.httpCode), '400');
		assert.equal(error.context.itemIndex, 0);
		assert.ok(!JSON.stringify(error).includes('cz_live_SECRET'));
		assert.ok(!String(error.stack).includes('cz_live_SECRET'));
		return true;
	});
});

test('a bad parameter becomes a NodeOperationError with the item index and sends nothing', async () => {
	const context = fakeContext({
		parameters: { resource: 'contact', operation: 'get', contactId: ' ' },
	});
	await assert.rejects(new ContactZapp().execute.call(context), (error) => {
		assert.equal(error.name, 'NodeOperationError');
		assert.equal(error.context.itemIndex, 0);
		return true;
	});
	assert.equal(context.sent.length, 0);
});

test('with Continue On Fail the error goes to the output and the other items still run', async () => {
	const context = fakeContext({
		parameters: { resource: 'account', operation: 'get' },
		items: [{ json: {} }, { json: {} }],
		continueOnFail: true,
		replies: [failure(401, { code: 'api_key_invalid', message: 'The API key is not valid.' }), { userId: 'u1' }],
	});
	const [out] = await new ContactZapp().execute.call(context);
	assert.equal(out.length, 2);
	assert.equal(out[0].json.error, 'The API key is not valid.');
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.equal(out[1].json.userId, 'u1');
});

// The trigger

const secret = 'cz_whsec_test';
const body = Buffer.from(JSON.stringify({ id: 'evt_1', event: 'contact.created', occurredAt: '2026-11-11T10:00:00Z' }));
const signed = (t, raw = body) => `t=${t},v1=${sign(secret, String(t), raw)}`;

function webhookContext({ header, rawBody = body, staticSecret = secret }) {
	const context = fakeContext({ staticData: { webhookSecret: staticSecret } });
	const response = { code: undefined, json: undefined };
	return Object.assign(context, {
		response,
		getRequestObject: () => ({ rawBody }),
		getHeaderData: () => (header === undefined ? {} : { 'contactzapp-signature': header }),
		getBodyData: () => JSON.parse(rawBody.toString()),
		getResponseObject: () => ({
			status(code) {
				response.code = code;
				return this;
			},
			json(value) {
				response.json = value;
			},
		}),
	});
}

test('the trigger emits the event when the signature is good', async () => {
	const context = webhookContext({ header: signed(Math.floor(Date.now() / 1000)) });
	const result = await new ContactZappTrigger().webhook.call(context);
	assert.equal(result.workflowData[0][0].json.id, 'evt_1');
	assert.equal(context.response.code, undefined);
});

test('the trigger refuses, and emits nothing, for a missing, bad or stale signature', async () => {
	const now = Math.floor(Date.now() / 1000);
	const cases = [
		[undefined, 'missing_signature'],
		[`t=${now},v1=${'0'.repeat(64)}`, 'bad_signature'],
		[signed(now - 301), 'stale_timestamp'],
		[signed(now + 301), 'stale_timestamp'],
		[signed(now, Buffer.from('{"id":"evt_2"}')), 'bad_signature'],
	];
	for (const [header, reason] of cases) {
		const context = webhookContext({ header });
		const result = await new ContactZappTrigger().webhook.call(context);
		assert.equal(result.workflowData, undefined, reason);
		assert.equal(result.noWebhookResponse, true, reason);
		assert.equal(context.response.code, 401, reason);
		assert.deepEqual(context.response.json, { code: reason });
	}
});

test('the trigger refuses when it has no stored secret', async () => {
	const context = webhookContext({ header: signed(Math.floor(Date.now() / 1000)), staticSecret: null });
	const result = await new ContactZappTrigger().webhook.call(context);
	assert.equal(result.workflowData, undefined);
	assert.equal(context.response.code, 401);
});

test('activating subscribes the webhook URL to the chosen event and keeps the id and secret', async () => {
	const context = fakeContext({
		parameters: { event: 'contacts.merged' },
		replies: [{ id: 'wh_1', secret: 'cz_whsec_x', webhook: { id: 'wh_1' } }],
	});
	assert.equal(await new ContactZappTrigger().webhookMethods.default.create.call(context), true);
	assert.equal(context.sent[0].method, 'POST');
	assert.equal(context.sent[0].url, `${BASE}/api/v1/webhooks`);
	assert.deepEqual(context.sent[0].body, { url: 'https://n8n.example.test/webhook/abc/webhook', event: 'contacts.merged' });
	assert.deepEqual(context.staticData, { webhookId: 'wh_1', webhookSecret: 'cz_whsec_x' });
});

test('deactivating deletes the subscription and forgets it; one already gone is fine', async () => {
	const context = fakeContext({ staticData: { webhookId: 'wh_1', webhookSecret: 's' }, replies: [undefined] });
	assert.equal(await new ContactZappTrigger().webhookMethods.default.delete.call(context), true);
	assert.equal(context.sent[0].method, 'DELETE');
	assert.equal(context.sent[0].url, `${BASE}/api/v1/webhooks/wh_1`);
	assert.deepEqual(context.staticData, {});

	const gone = fakeContext({
		staticData: { webhookId: 'wh_2', webhookSecret: 's' },
		replies: [failure(404, { code: 'not_found', message: 'Not found.' })],
	});
	assert.equal(await new ContactZappTrigger().webhookMethods.default.delete.call(gone), true);
	assert.deepEqual(gone.staticData, {});

	const broken = fakeContext({
		staticData: { webhookId: 'wh_3', webhookSecret: 's' },
		replies: [failure(500, { code: 'internal_error', message: 'Try again.' })],
	});
	assert.equal(await new ContactZappTrigger().webhookMethods.default.delete.call(broken), false);
	assert.equal(broken.staticData.webhookId, 'wh_3');
});

test('an existing subscription is reused only when it is active for this URL and event', async () => {
	const url = 'https://n8n.example.test/webhook/abc/webhook';
	const listed = (webhook) => ({ webhooks: [{ id: 'wh_1', url, event: 'contact.created', state: 'active', ...webhook }] });
	const run = async (reply, parameters = { event: 'contact.created' }) => {
		const context = fakeContext({ parameters, staticData: { webhookId: 'wh_1', webhookSecret: 's' }, replies: [reply] });
		const found = await new ContactZappTrigger().webhookMethods.default.checkExists.call(context);
		return { found, context };
	};
	assert.equal((await run(listed({}))).found, true);
	assert.equal((await run(listed({ state: 'disabled' }))).found, false);
	assert.equal((await run(listed({ url: 'https://other.example.test/' }))).found, false);
	assert.equal((await run(listed({}), { event: 'contact.updated' })).found, false);
	assert.equal((await run({ webhooks: [] })).found, false);
	const none = fakeContext({ parameters: { event: 'contact.created' } });
	assert.equal(await new ContactZappTrigger().webhookMethods.default.checkExists.call(none), false);
	assert.equal(none.sent.length, 0);
});
