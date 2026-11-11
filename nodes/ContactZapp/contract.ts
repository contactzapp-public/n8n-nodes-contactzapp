/**
 * The one place this package states what it takes from the ContactZapp API.
 *
 * Every request the nodes make is built from `operations`, and every field name they read
 * or write comes from `schemas` and `enums`. `contract-uses.json` is generated from this
 * file (`npm run contract`), and ContactZapp checks that copy against the API's published
 * spec, so a rename in the API shows up there before it breaks a workflow.
 *
 * Operation ids, paths and names are those of https://app.contactz.app/api/v1/openapi.json.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface OperationContract<Q extends string = string> {
	method: HttpMethod;
	path: string;
	/** The query parameters the package sends, by name. */
	query: { readonly [K in Q]: K };
}

const names = <const T extends readonly string[]>(list: T) =>
	Object.fromEntries(list.map((name) => [name, name])) as { readonly [K in T[number]]: K };

const operation = <const Q extends readonly string[]>(
	method: HttpMethod,
	path: string,
	query: Q,
): OperationContract<Q[number]> => ({ method, path, query: names(query) });

export const operations = {
	getV1Me: operation('GET', '/api/v1/me', []),
	listV1Contacts: operation('GET', '/api/v1/contacts', ['cursor', 'email', 'limit', 'phone', 'query']),
	createV1Contact: operation('POST', '/api/v1/contacts', []),
	getV1Contact: operation('GET', '/api/v1/contacts/{id}', []),
	updateV1Contact: operation('PATCH', '/api/v1/contacts/{id}', []),
	postV1Sync: operation('POST', '/api/v1/sync', []),
	listV1Webhooks: operation('GET', '/api/v1/webhooks', []),
	createV1Webhook: operation('POST', '/api/v1/webhooks', []),
	deleteV1Webhook: operation('DELETE', '/api/v1/webhooks/{id}', []),
} as const;

export type OperationId = keyof typeof operations;

/** The properties of each schema the package reads or writes. */
export const schemas = {
	LabeledValue: names(['label', 'preferred', 'value']),
	PartialDate: names(['day', 'month', 'year']),
	SyncJobStatus: names(['status']),
	V1Contact: names([
		'displayName',
		'emails',
		'firstName',
		'id',
		'jobTitle',
		'lastName',
		'organization',
		'phones',
		'publicId',
		'updatedAt',
	]),
	V1ContactInput: names([
		'addresses',
		'birthday',
		'emails',
		'firstName',
		'jobTitle',
		'labels',
		'lastName',
		'middleName',
		'nickname',
		'notes',
		'organization',
		'phones',
		'prefix',
		'suffix',
		'urls',
	]),
	V1ContactPage: names(['contacts', 'nextCursor']),
	V1ContactWriteResult: names(['contact', 'outcome', 'possibleMatches']),
	V1Error: names(['code', 'message']),
	V1Me: names(['email', 'scopes']),
	V1Webhook: names(['id', 'state', 'url']),
	V1WebhookCreateRequest: names(['event', 'url']),
	V1WebhookCreated: names(['id', 'secret']),
	V1WebhookList: names(['webhooks']),
} as const;

/** The vocabularies the package uses: a schema that is an enum, or `Schema.property`. */
export const enums = {
	V1ErrorCode: names(['api_key_invalid', 'api_key_missing']),
	V1TriggerEvent: names([
		'account.needs_attention',
		'contact.created',
		'contact.updated',
		'contacts.merged',
		'match.needs_review',
	]),
	WebhookState: names(['active']),
} as const;

export type TriggerEvent = keyof typeof enums.V1TriggerEvent;

/** What `contract-uses.json` declares: the shape ContactZapp's generator reads. */
export function contractUses() {
	const sorted = (record: Record<string, string>) => Object.values(record).sort();
	const bySchema = (group: Record<string, Record<string, string>>) =>
		Object.fromEntries(
			Object.keys(group)
				.sort()
				.map((key) => [key, sorted(group[key])]),
		);
	const requests = Object.fromEntries(
		Object.keys(operations)
			.sort()
			.map((id) => {
				const { method, path } = operations[id as OperationId];
				return [id, { method, path }];
			}),
	);
	return {
		operations: Object.fromEntries(
			Object.keys(operations)
				.sort()
				.map((id) => [id, sorted(operations[id as OperationId].query)]),
		),
		schemas: bySchema(schemas),
		enums: bySchema(enums),
		requests,
	};
}
