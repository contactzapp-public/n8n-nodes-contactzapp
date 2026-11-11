import { createHmac, timingSafeEqual } from 'crypto';

/** A delivery whose timestamp is further than this from the clock is refused. */
export const TOLERANCE_SECONDS = 5 * 60;

export type SignatureRefusal = 'missing_signature' | 'malformed_signature' | 'stale_timestamp' | 'bad_signature';

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureRefusal };

export interface SignatureInput {
	/** The `ContactZapp-Signature` header: `t=<unix seconds>,v1=<hex signature>`. */
	header: string | string[] | undefined;
	/** The body exactly as it arrived, before any parsing. */
	rawBody: Buffer | string | undefined;
	/** The subscription's signing secret. */
	secret: string | undefined;
	/** The clock, in unix seconds. */
	nowSeconds: number;
}

/** The hex HMAC-SHA256 of the timestamp, a full stop and the raw body, keyed with the secret. */
export function sign(secret: string, timestamp: string, rawBody: Buffer | string): string {
	return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function verifySignature({ header, rawBody, secret, nowSeconds }: SignatureInput): SignatureResult {
	const value = Array.isArray(header) ? header.join(',') : header;
	if (!value) return { ok: false, reason: 'missing_signature' };
	if (rawBody === undefined || !secret) return { ok: false, reason: 'bad_signature' };

	let timestamp = '';
	const signatures: string[] = [];
	for (const part of value.split(',')) {
		const at = part.indexOf('=');
		if (at < 0) continue;
		const key = part.slice(0, at).trim();
		const val = part.slice(at + 1).trim();
		if (key === 't') timestamp = val;
		else if (key === 'v1') signatures.push(val);
	}
	if (!/^\d{1,15}$/.test(timestamp) || signatures.length === 0) {
		return { ok: false, reason: 'malformed_signature' };
	}

	const expected = Buffer.from(sign(secret, timestamp, rawBody), 'hex');
	const matches = signatures
		.map((candidate) => (/^[0-9a-fA-F]{64}$/.test(candidate) ? Buffer.from(candidate, 'hex') : undefined))
		.map((candidate) => candidate !== undefined && timingSafeEqual(candidate, expected));
	// Every candidate is compared before the answer is read, so the time taken does not
	// tell a caller which one matched.
	if (!matches.includes(true)) return { ok: false, reason: 'bad_signature' };

	if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) {
		return { ok: false, reason: 'stale_timestamp' };
	}
	return { ok: true };
}
