import type {
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	IDataObject,
	JsonObject,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { schemas } from './contract';
import type { RequestSpec } from './requests';

export const CREDENTIAL_NAME = 'contactZappApi';

type Context = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

interface ErrorLike {
	httpCode?: string | number;
	statusCode?: number;
	status?: number;
	message?: string;
	response?: { status?: number; statusCode?: number; body?: unknown; data?: unknown };
	cause?: { response?: { status?: number; data?: unknown; body?: unknown } };
}

/** The status and the API's own error body, whichever way the HTTP helper reports them. */
export function describeFailure(error: unknown): {
	status?: number;
	code?: string;
	message?: string;
	fallback: string;
} {
	const e = (error ?? {}) as ErrorLike;
	const response = e.response ?? e.cause?.response;
	const body = (response?.body ?? response?.data) as Record<string, unknown> | string | undefined;
	const parsed = typeof body === 'string' ? safeJson(body) : body;
	const status = Number(e.httpCode ?? e.statusCode ?? e.status ?? response?.status) || undefined;
	const apiError = schemas.V1Error;
	return {
		status,
		code: typeof parsed?.[apiError.code] === 'string' ? (parsed[apiError.code] as string) : undefined,
		message: typeof parsed?.[apiError.message] === 'string' ? (parsed[apiError.message] as string) : undefined,
		fallback: typeof e.message === 'string' ? e.message : 'The request failed.',
	};
}

function safeJson(text: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * An API failure as the node reports it: the API's own message, its code and the status.
 * Built from the fields we read, never from the raw error, which carries the request headers.
 */
export function apiError(context: Context, error: unknown, itemIndex?: number): NodeApiError {
	const failure = describeFailure(error);
	const message = failure.message ?? failure.fallback;
	const payload: JsonObject = { message, code: failure.code ?? null };
	return new NodeApiError(context.getNode(), payload, {
		message,
		description: failure.code ? `Error code: ${failure.code}` : undefined,
		httpCode: failure.status === undefined ? undefined : String(failure.status),
		itemIndex,
	});
}

export async function baseUrl(context: Context): Promise<string> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	return String(credentials.baseUrl).replace(/\/+$/, '');
}

/** Sends one request with the credential's API key. The caller decides how to report a failure. */
export async function send(context: Context, request: RequestSpec): Promise<unknown> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${await baseUrl(context)}${request.path}`,
		json: true,
	};
	if (request.qs) options.qs = request.qs as IDataObject;
	if (request.body) options.body = request.body;
	if (request.headers) options.headers = request.headers;
	return await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_NAME, options);
}
