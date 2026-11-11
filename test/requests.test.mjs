import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildRequest, listContactsRequest, contactBody, contactFilter, parseBirthday, simplifyContact, InputError } =
	require('../dist/nodes/ContactZapp/requests.js');

const params = (values) => (name, fallback) => (name in values ? values[name] : fallback);

test('Contact Get reads one contact by id, with the id escaped', () => {
	const request = buildRequest('contact', 'get', params({ contactId: ' CS-0042 ' }));
	assert.equal(request.operationId, 'getV1Contact');
	assert.equal(request.method, 'GET');
	assert.equal(request.path, '/api/v1/contacts/CS-0042');
	assert.equal(request.body, undefined);
	assert.equal(buildRequest('contact', 'get', params({ contactId: 'a/b' })).path, '/api/v1/contacts/a%2Fb');
});

test('Contact Get with no id is a configuration error', () => {
	assert.throws(() => buildRequest('contact', 'get', params({ contactId: '  ' })), InputError);
});

test('Contact Create posts the fields it was given and nothing else', () => {
	const request = buildRequest(
		'contact',
		'create',
		params({
			fields: {
				firstName: 'Ada',
				lastName: 'Lovelace',
				organization: 'Analytical Engines',
				emails: { values: [{ label: 'Work', value: 'ada@example.com', preferred: true }] },
				phones: { values: [{ label: '', value: '+12025550108', preferred: false }] },
				labels: 'Clients, Friends,,',
				birthday: '1815-12-10',
			},
			options: { idempotencyKey: 'run-1' },
		}),
	);
	assert.equal(request.operationId, 'createV1Contact');
	assert.equal(request.method, 'POST');
	assert.equal(request.path, '/api/v1/contacts');
	assert.deepEqual(request.body, {
		firstName: 'Ada',
		lastName: 'Lovelace',
		organization: 'Analytical Engines',
		emails: [{ label: 'Work', value: 'ada@example.com', preferred: true }],
		phones: [{ label: '', value: '+12025550108' }],
		labels: ['Clients', 'Friends'],
		birthday: { year: 1815, month: 12, day: 10 },
	});
	assert.deepEqual(request.headers, { 'Idempotency-Key': 'run-1' });
});

test('Contact Create without an idempotency key sends no such header', () => {
	assert.equal(buildRequest('contact', 'create', params({ fields: { firstName: 'Ada' } })).headers, undefined);
});

test('Contact Update patches only the fields it was given', () => {
	const request = buildRequest(
		'contact',
		'update',
		params({ contactId: 'abc', updateFields: { jobTitle: '', notes: 'Met at the fair' } }),
	);
	assert.equal(request.operationId, 'updateV1Contact');
	assert.equal(request.method, 'PATCH');
	assert.equal(request.path, '/api/v1/contacts/abc');
	assert.deepEqual(request.body, { jobTitle: '', notes: 'Met at the fair' });
});

test('an empty birthday clears it, and a year-less one has year 0', () => {
	assert.deepEqual(contactBody({ birthday: '' }), { birthday: null });
	assert.deepEqual(parseBirthday('--03-15'), { year: 0, month: 3, day: 15 });
	assert.deepEqual(parseBirthday('1990-03-15T00:00:00.000Z'), { year: 1990, month: 3, day: 15 });
	assert.throws(() => parseBirthday('15 March'), InputError);
});

test('Sync Start and Account Get are one call each', () => {
	const sync = buildRequest('sync', 'start', params({}));
	assert.deepEqual([sync.operationId, sync.method, sync.path], ['postV1Sync', 'POST', '/api/v1/sync']);
	const me = buildRequest('account', 'get', params({}));
	assert.deepEqual([me.operationId, me.method, me.path], ['getV1Me', 'GET', '/api/v1/me']);
});

test('an operation the node does not have is a configuration error', () => {
	assert.throws(() => buildRequest('contact', 'delete', params({})), InputError);
});

test('Contact Get Many asks for a page, with the filter and the cursor', () => {
	const request = listContactsRequest(params({ filters: { phone: ' +12025550108 ' } }), 50, 'next-1');
	assert.equal(request.operationId, 'listV1Contacts');
	assert.equal(request.method, 'GET');
	assert.equal(request.path, '/api/v1/contacts');
	assert.deepEqual(request.qs, { phone: '+12025550108', limit: 50, cursor: 'next-1' });
});

test('Contact Get Many never asks for more than 200 at a time, nor fewer than 1', () => {
	assert.equal(listContactsRequest(params({}), 5000).qs.limit, 200);
	assert.equal(listContactsRequest(params({}), 0).qs.limit, 1);
	assert.deepEqual(listContactsRequest(params({}), 10).qs, { limit: 10 });
});

test('Contact Get Many takes one filter at a time', () => {
	assert.deepEqual(contactFilter({ query: 'ada' }), { query: 'ada' });
	assert.deepEqual(contactFilter({ email: '', phone: '' }), {});
	assert.throws(() => contactFilter({ email: 'a@b.c', phone: '+1' }), InputError);
});

test('Simplify keeps the main fields and the preferred email and phone number', () => {
	const simple = simplifyContact({
		id: 'c1',
		publicId: 'CS-0001',
		displayName: 'Ada Lovelace',
		firstName: 'Ada',
		lastName: 'Lovelace',
		organization: 'Analytical Engines',
		jobTitle: 'Mathematician',
		emails: [
			{ label: 'Home', value: 'home@example.com' },
			{ label: 'Work', value: 'ada@example.com', preferred: true },
		],
		phones: [],
		addresses: [{ label: '', value: 'London' }],
		notes: 'long text',
		updatedAt: '2026-11-11T10:00:00Z',
	});
	assert.deepEqual(simple, {
		id: 'c1',
		publicId: 'CS-0001',
		displayName: 'Ada Lovelace',
		firstName: 'Ada',
		lastName: 'Lovelace',
		organization: 'Analytical Engines',
		jobTitle: 'Mathematician',
		email: 'ada@example.com',
		phone: '',
		updatedAt: '2026-11-11T10:00:00Z',
	});
});
