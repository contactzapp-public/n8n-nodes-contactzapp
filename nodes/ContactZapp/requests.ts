import { type HttpMethod, type OperationId, operations, schemas } from './contract';

/** Reads one node parameter for the current item. */
export type GetParameter = (name: string, fallback?: unknown) => unknown;

export interface RequestSpec {
	operationId: OperationId;
	method: HttpMethod;
	/** The path with its ids filled in. */
	path: string;
	qs?: Record<string, string | number>;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
}

/** A parameter value the person has to correct; the nodes report it as a configuration error. */
export class InputError extends Error {}

/** The largest page the contacts list serves. */
export const MAX_PAGE_SIZE = 200;

type Row = Record<string, unknown>;

const contactFields = schemas.V1ContactInput;
const labeled = schemas.LabeledValue;
const date = schemas.PartialDate;

const TEXT_FIELDS = [
	contactFields.firstName,
	contactFields.middleName,
	contactFields.lastName,
	contactFields.prefix,
	contactFields.suffix,
	contactFields.nickname,
	contactFields.organization,
	contactFields.jobTitle,
	contactFields.notes,
] as const;

const LIST_FIELDS = [
	contactFields.emails,
	contactFields.phones,
	contactFields.addresses,
	contactFields.urls,
] as const;

function fill(operationId: OperationId, id?: string): string {
	const { path } = operations[operationId];
	if (id === undefined) return path;
	const trimmed = id.trim();
	if (trimmed === '') throw new InputError('Contact ID is empty. Enter the contact’s ID.');
	return path.replace('{id}', encodeURIComponent(trimmed));
}

/** `1990-03-15`, `1990-03-15T00:00:00.000Z` or `--03-15` (no year) as the API's partial date. */
export function parseBirthday(value: string): Record<string, number> | null {
	const text = value.trim();
	if (text === '') return null;
	const full = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
	const noYear = /^--(\d{2})-(\d{2})$/.exec(text);
	if (!full && !noYear) {
		throw new InputError(
			`Birthday “${text}” is not a date. Use 2000-12-31, or --12-31 when the year is not known.`,
		);
	}
	const [year, month, day] = full ? [full[1], full[2], full[3]] : ['0', noYear![1], noYear![2]];
	return { [date.year]: Number(year), [date.month]: Number(month), [date.day]: Number(day) };
}

function labeledValues(raw: unknown): Row[] {
	const rows = (raw as { values?: Row[] } | undefined)?.values ?? [];
	return rows.map((row) => {
		const entry: Row = { [labeled.label]: String(row.label ?? ''), [labeled.value]: String(row.value ?? '') };
		if (row.preferred === true) entry[labeled.preferred] = true;
		return entry;
	});
}

/** The body of a contact create or update from the node's contact fields. */
export function contactBody(fields: Row): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const name of TEXT_FIELDS) {
		if (fields[name] !== undefined) body[name] = String(fields[name]);
	}
	for (const name of LIST_FIELDS) {
		const entries = labeledValues(fields[name]);
		if (entries.length > 0) body[name] = entries;
	}
	if (fields[contactFields.labels] !== undefined) {
		body[contactFields.labels] = String(fields[contactFields.labels])
			.split(',')
			.map((label) => label.trim())
			.filter((label) => label !== '');
	}
	if (fields[contactFields.birthday] !== undefined) {
		body[contactFields.birthday] = parseBirthday(String(fields[contactFields.birthday]));
	}
	return body;
}

function idempotencyHeaders(options: Row): Record<string, string> | undefined {
	const key = typeof options.idempotencyKey === 'string' ? options.idempotencyKey.trim() : '';
	return key === '' ? undefined : { 'Idempotency-Key': key };
}

/** The filter of Get Many: at most one of email, phone and search text. */
export function contactFilter(filters: Row): Record<string, string> {
	const query = operations.listV1Contacts.query;
	const wanted: Array<[string, unknown]> = [
		[query.email, filters.email],
		[query.phone, filters.phone],
		[query.query, filters.query],
	];
	const given = wanted.filter(([, value]) => typeof value === 'string' && value.trim() !== '');
	if (given.length > 1) {
		throw new InputError('Use one filter at a time: Email, Phone Number or Search Text.');
	}
	return given.length === 0 ? {} : { [given[0][0]]: String(given[0][1]).trim() };
}

/** One page of Get Many. `cursor` is the previous page's `nextCursor`. */
export function listContactsRequest(get: GetParameter, pageSize: number, cursor?: string): RequestSpec {
	const query = operations.listV1Contacts.query;
	const qs: Record<string, string | number> = {
		...contactFilter((get('filters', {}) ?? {}) as Row),
		[query.limit]: Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE),
	};
	if (cursor) qs[query.cursor] = cursor;
	return { operationId: 'listV1Contacts', method: operations.listV1Contacts.method, path: fill('listV1Contacts'), qs };
}

/** The single request of every operation but Get Many. */
export function buildRequest(resource: string, operation: string, get: GetParameter): RequestSpec {
	const spec = (operationId: OperationId, id?: string): RequestSpec => ({
		operationId,
		method: operations[operationId].method,
		path: fill(operationId, id),
	});

	if (resource === 'contact' && operation === 'get') {
		return spec('getV1Contact', String(get('contactId', '')));
	}
	if (resource === 'contact' && operation === 'create') {
		const request = spec('createV1Contact');
		request.body = contactBody((get('fields', {}) ?? {}) as Row);
		request.headers = idempotencyHeaders((get('options', {}) ?? {}) as Row);
		return request;
	}
	if (resource === 'contact' && operation === 'update') {
		const request = spec('updateV1Contact', String(get('contactId', '')));
		request.body = contactBody((get('updateFields', {}) ?? {}) as Row);
		request.headers = idempotencyHeaders((get('options', {}) ?? {}) as Row);
		return request;
	}
	if (resource === 'sync' && operation === 'start') return spec('postV1Sync');
	if (resource === 'account' && operation === 'get') return spec('getV1Me');
	throw new InputError(`The operation “${operation}” on “${resource}” is not available.`);
}

const first = (entries: unknown, preferredKey: string): string => {
	if (!Array.isArray(entries)) return '';
	const rows = entries as Row[];
	const chosen = rows.find((row) => row[preferredKey] === true) ?? rows[0];
	return typeof chosen?.[labeled.value] === 'string' ? (chosen[labeled.value] as string) : '';
};

/** A contact cut down to the fields most workflows use. */
export function simplifyContact(contact: Row): Row {
	const c = schemas.V1Contact;
	return {
		[c.id]: contact[c.id],
		[c.publicId]: contact[c.publicId],
		[c.displayName]: contact[c.displayName],
		[c.firstName]: contact[c.firstName],
		[c.lastName]: contact[c.lastName],
		[c.organization]: contact[c.organization],
		[c.jobTitle]: contact[c.jobTitle],
		email: first(contact[c.emails], labeled.preferred),
		phone: first(contact[c.phones], labeled.preferred),
		[c.updatedAt]: contact[c.updatedAt],
	};
}
