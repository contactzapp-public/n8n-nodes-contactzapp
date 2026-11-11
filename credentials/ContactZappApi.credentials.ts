import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { enums, operations, schemas } from '../nodes/ContactZapp/contract';

export class ContactZappApi implements ICredentialType {
	name = 'contactZappApi';

	displayName = 'ContactZapp API';

	icon = {
		light: 'file:contactzapp.svg',
		dark: 'file:contactzapp.dark.svg',
	} as const;

	documentationUrl = 'https://github.com/contactzapp-public/n8n-nodes-contactzapp#authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'cz_live_…',
			description:
				'Create a key in ContactZapp under Settings › Advanced. Give it the permissions the workflow needs.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'hidden',
			default: 'https://app.contactz.app',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: operations.getV1Me.path,
			method: operations.getV1Me.method,
			ignoreHttpStatusErrors: true,
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: schemas.V1Error.code,
					value: enums.V1ErrorCode.api_key_invalid,
					message: 'The API key is not valid. It may have been revoked. Create a new one in ContactZapp.',
				},
			},
			{
				type: 'responseSuccessBody',
				properties: {
					key: schemas.V1Error.code,
					value: enums.V1ErrorCode.api_key_missing,
					message: 'Enter the API key. Create one in ContactZapp under Settings › Advanced.',
				},
			},
		],
	};
}
