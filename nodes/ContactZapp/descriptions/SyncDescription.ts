import type { INodeProperties } from 'n8n-workflow';

export const syncOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['sync'] } },
		options: [
			{
				name: 'Start',
				value: 'start',
				description: 'Start a sync now, instead of waiting for the next one',
				action: 'Start a sync',
			},
		],
		default: 'start',
	},
];
