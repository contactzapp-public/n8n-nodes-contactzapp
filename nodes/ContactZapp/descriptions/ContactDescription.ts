import type { INodeProperties } from 'n8n-workflow';

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['contact'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Add a contact',
				action: 'Create a contact',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get one contact',
				action: 'Get a contact',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Find contacts, or list many of them',
				action: 'Get many contacts',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Change a contact',
				action: 'Update a contact',
			},
		],
		default: 'get',
	},
];

const labeledList = (displayName: string, name: string, entry: string): INodeProperties => ({
	displayName,
	name,
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: `Add ${entry}`,
	default: {},
	options: [
		{
			displayName: entry,
			name: 'values',
			values: [
				{ displayName: 'Label', name: 'label', type: 'string', default: '', placeholder: 'e.g. Work' },
				{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				{
					displayName: 'Preferred',
					name: 'preferred',
					type: 'boolean',
					default: false,
					description: 'Whether this is the one to use first',
				},
			],
		},
	],
});

/** The contact fields a create or an update can set. Listed once, shown in both. */
const contactFieldOptions: INodeProperties[] = [
	labeledList('Addresses', 'addresses', 'Address'),
	{
		displayName: 'Birthday',
		name: 'birthday',
		type: 'string',
		default: '',
		placeholder: 'e.g. 1990-03-15',
		description:
			'Date as YYYY-MM-DD, or --MM-DD when the year is not known. Empty clears the birthday.',
	},
	labeledList('Emails', 'emails', 'Email'),
	{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
	{ displayName: 'Job Title', name: 'jobTitle', type: 'string', default: '' },
	{
		displayName: 'Labels',
		name: 'labels',
		type: 'string',
		default: '',
		placeholder: 'e.g. Clients, Friends',
		description: 'Labels separated by commas',
	},
	{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
	{ displayName: 'Middle Name', name: 'middleName', type: 'string', default: '' },
	{ displayName: 'Name Prefix', name: 'prefix', type: 'string', default: '' },
	{ displayName: 'Name Suffix', name: 'suffix', type: 'string', default: '' },
	{ displayName: 'Nickname', name: 'nickname', type: 'string', default: '' },
	{ displayName: 'Notes', name: 'notes', type: 'string', default: '' },
	{ displayName: 'Company', name: 'organization', type: 'string', default: '' },
	labeledList('Phone Numbers', 'phones', 'Phone Number'),
	labeledList('Websites', 'urls', 'Website'),
];

const idempotencyOption: INodeProperties = {
	displayName: 'Idempotency Key',
	name: 'idempotencyKey',
	type: 'string',
	default: '',
	description:
		'Any text you choose for this write. Run it again with the same key within 24 hours and nothing is written twice.',
};

export const contactFields: INodeProperties[] = [
	// Get and Update
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. CS-0042',
		displayOptions: { show: { resource: ['contact'], operation: ['get', 'update'] } },
		description: 'The contact’s ID, or the short ID ContactZapp shows, such as CS-0042',
	},

	// Create
	{
		displayName: 'Contact Fields',
		name: 'fields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
		description:
			'The contact needs at least one value. If you already have this person, ContactZapp may add the values to that contact.',
		options: contactFieldOptions,
	},

	// Update
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
		description:
			'Only the fields you add change. A list you add replaces the whole list, and an empty text clears the field.',
		options: contactFieldOptions,
	},

	// Create and Update
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['create', 'update'] } },
		options: [idempotencyOption],
	},

	// Get and Get Many
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['contact'], operation: ['get', 'getAll'] } },
		description:
			'Whether to return the main fields only: ID, name, company, job title, first email address and first phone number',
	},

	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: { show: { resource: ['contact'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
		description: 'Use one filter at a time. With none, every contact is returned, newest first.',
		options: [
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Contacts with this email address',
			},
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				placeholder: 'e.g. +12025550108',
				default: '',
				description: 'Contacts with this number. Include the country code, for example +12025550108.',
			},
			{
				displayName: 'Search Text',
				name: 'query',
				type: 'string',
				default: '',
				description: 'Contacts found by searching the way the Contacts screen does',
			},
		],
	},
];
