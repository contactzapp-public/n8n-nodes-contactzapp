import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { apiError, describeFailure, send } from './GenericFunctions';
import { enums, operations, schemas, webhookSignature } from './contract';
import type { TriggerEvent } from './contract';
import { verifySignature } from './signature';

type Row = Record<string, unknown>;

const SIGNATURE_HEADER = webhookSignature.header.toLowerCase();

const eventNames: Record<TriggerEvent, string> = {
	'contact.created': 'Contact Created',
	'contact.updated': 'Contact Updated',
	'contacts.merged': 'Contacts Merged',
	'match.needs_review': 'Match Needs Review',
	'account.needs_attention': 'Account Needs Attention',
};

const subscription = (context: IHookFunctions) => {
	const data = context.getWorkflowStaticData('node');
	return {
		get id() {
			return typeof data.webhookId === 'string' ? data.webhookId : undefined;
		},
		get secret() {
			return typeof data.webhookSecret === 'string' ? data.webhookSecret : undefined;
		},
		remember(id: string, secret: string) {
			data.webhookId = id;
			data.webhookSecret = secret;
		},
		forget() {
			delete data.webhookId;
			delete data.webhookSecret;
		},
	};
};

export class ContactZappTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ContactZapp Trigger',
		name: 'contactZappTrigger',
		icon: { light: 'file:contactzapp.svg', dark: 'file:contactzapp.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when something happens in your contacts',
		defaults: { name: 'ContactZapp Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'contactZappApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Trigger On',
				name: 'event',
				type: 'options',
				required: true,
				default: 'contact.created',
				options: (Object.keys(enums.V1TriggerEvent) as TriggerEvent[]).map((event) => ({
					name: eventNames[event],
					value: event,
				})),
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const stored = subscription(this);
				if (stored.id === undefined) return false;
				const url = this.getNodeWebhookUrl('default');
				const event = this.getNodeParameter('event') as string;
				try {
					const list = (await send(this, {
						operationId: 'listV1Webhooks',
						method: operations.listV1Webhooks.method,
						path: operations.listV1Webhooks.path,
					})) as Row;
					const webhooks = (list[schemas.V1WebhookList.webhooks] as Row[] | undefined) ?? [];
					const found = webhooks.some(
						(webhook) =>
							webhook[schemas.V1Webhook.id] === stored.id &&
							webhook[schemas.V1Webhook.url] === url &&
							webhook[schemas.V1WebhookCreateRequest.event] === event &&
							webhook[schemas.V1Webhook.state] === enums.WebhookState.active,
					);
					if (!found) stored.forget();
					return found;
				} catch (error) {
					throw apiError(this, error);
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const request = schemas.V1WebhookCreateRequest;
				try {
					const created = (await send(this, {
						operationId: 'createV1Webhook',
						method: operations.createV1Webhook.method,
						path: operations.createV1Webhook.path,
						body: {
							[request.url]: this.getNodeWebhookUrl('default'),
							[request.event]: this.getNodeParameter('event') as string,
						},
					})) as Row;
					const id = created[schemas.V1WebhookCreated.id];
					const secret = created[schemas.V1WebhookCreated.secret];
					if (typeof id !== 'string' || typeof secret !== 'string') return false;
					subscription(this).remember(id, secret);
					return true;
				} catch (error) {
					throw apiError(this, error);
				}
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const stored = subscription(this);
				if (stored.id === undefined) return true;
				try {
					await send(this, {
						operationId: 'deleteV1Webhook',
						method: operations.deleteV1Webhook.method,
						path: operations.deleteV1Webhook.path.replace('{id}', encodeURIComponent(stored.id)),
					});
				} catch (error) {
					// A subscription that is already gone is what we wanted.
					if (describeFailure(error).status !== 404) return false;
				}
				stored.forget();
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject() as { rawBody?: Buffer | string };
		const header = this.getHeaderData()[SIGNATURE_HEADER];
		const secret = this.getWorkflowStaticData('node').webhookSecret;

		const verdict = verifySignature({
			header,
			rawBody: request.rawBody,
			secret: typeof secret === 'string' ? secret : undefined,
			nowSeconds: Math.floor(Date.now() / 1000),
		});
		if (!verdict.ok) {
			// Say why in a code, never the body or the secret. Nothing reaches the workflow.
			this.getResponseObject().status(401).json({ code: verdict.reason });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData();
		return { workflowData: [this.helpers.returnJsonArray(body as IDataObject)] };
	}
}
