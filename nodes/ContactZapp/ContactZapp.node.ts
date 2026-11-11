import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { apiError, send } from './GenericFunctions';
import { accountOperations } from './descriptions/AccountDescription';
import { contactFields, contactOperations } from './descriptions/ContactDescription';
import { syncOperations } from './descriptions/SyncDescription';
import { schemas } from './contract';
import {
	InputError,
	MAX_PAGE_SIZE,
	buildRequest,
	listContactsRequest,
	simplifyContact,
} from './requests';

type Row = Record<string, unknown>;

export class ContactZapp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ContactZapp',
		name: 'contactZapp',
		icon: { light: 'file:contactzapp.svg', dark: 'file:contactzapp.dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Find, add and update your contacts, and start a sync',
		defaults: { name: 'ContactZapp' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'contactZappApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Sync', value: 'sync' },
				],
				default: 'contact',
			},
			...accountOperations,
			...contactOperations,
			...syncOperations,
			...contactFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const get = (name: string, fallback?: unknown) =>
					this.getNodeParameter(name, itemIndex, fallback);
				const pairedItem = { item: itemIndex };
				const simplify = (contact: Row) =>
					get('simplify', false) === true ? simplifyContact(contact) : contact;
				const emit = (json: unknown) => returnData.push({ json: json as INodeExecutionData['json'], pairedItem });

				if (resource === 'contact' && operation === 'getAll') {
					const returnAll = get('returnAll', false) === true;
					const wanted = returnAll ? Infinity : Number(get('limit', 50));
					let cursor: string | undefined;
					let collected = 0;
					do {
						const page = (await send(
							this,
							listContactsRequest(get, Math.min(wanted - collected, MAX_PAGE_SIZE), cursor),
						)) as Row;
						const contacts = (page[schemas.V1ContactPage.contacts] as Row[] | undefined) ?? [];
						for (const contact of contacts.slice(0, wanted - collected)) {
							emit(simplify(contact));
							collected++;
						}
						const next = page[schemas.V1ContactPage.nextCursor];
						cursor = typeof next === 'string' && next !== '' && collected < wanted ? next : undefined;
					} while (cursor !== undefined);
					continue;
				}

				const result = (await send(this, buildRequest(resource, operation, get))) as Row;
				emit(resource === 'contact' && operation === 'get' ? simplify(result) : result);
			} catch (error) {
				const reported =
					error instanceof InputError
						? new NodeOperationError(this.getNode(), error.message, { itemIndex })
						: apiError(this, error, itemIndex);
				if (this.continueOnFail()) {
					returnData.push({ json: { error: reported.message }, pairedItem: { item: itemIndex } });
					continue;
				}
				throw reported;
			}
		}

		return [returnData];
	}
}
