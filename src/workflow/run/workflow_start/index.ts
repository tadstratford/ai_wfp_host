import { WFP_API, Result, ToolDefinition } from '@backend/core/wfp';

/**
 * Workflow Start Tool (WFP_API Version)
 * Entry point for workflows - processes initial inputs
 */
export const Tool_run = async (api: WFP_API): Promise<Result> => {
    console.log('---> running utils-workflow-start tool');

    // Check for initial user input (from chat interface)
    const userMessage = String(api.getParameter('__internal_initialInput') ?? '');

    if (userMessage) {
        // Chat workflow: store message for downstream nodes
        api.setParameter('userMessage', { _meta: { type: 'string', source: 'user_input', length: userMessage.length }, data: userMessage });

        api.addMessage({
            role: 'tool',
            html: `<div class="workflow-start">
        <div class="font-semibold">Chat Workflow Started</div>
        <div class="text-xs text-gray-500">Processing: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"</div>
      </div>`,
            markdown: `Chat workflow started with message...`
        });
    } else {
        // Automation workflow: standard start
        api.addMessage({
            role: 'tool',
            html: `<div class="workflow-start">
        <div class="font-semibold">Workflow Started</div>
        <div class="text-xs text-gray-500">Inputs processed</div>
      </div>`,
            markdown: `Workflow started.`
        });
    }

    return { status: 'success' };
};

export const tool_definition = async (): Promise<ToolDefinition> => {
    return {
        tool_id: 'workflow_start',
        name: 'Workflow Start',
        apiVersion: '1.0.0',
        description: 'Entry point for the workflow. Defines expected input parameters.',
        description_md: `## What it does
Entry point for every workflow. When a user starts a session from the chat interface, their opening message is captured as \`{{userMessage}}\` for downstream nodes to use.

## Inputs
- **userMessage** — pre-filled from the session start input; normally left blank in configuration

## Outputs
- **userMessage** — the user's opening message, available to all downstream nodes as \`{{userMessage}}\`

## Notes
Every workflow must begin with this node. Do not add nodes before it.`,
        category: 'flow',

        inputs: [
            {
                name: 'userMessage',
                type: 'string',
                value: '',
                required: false
            }
        ],
        outputs: [{
            name: 'userMessage',
            type: 'string',

        }]

    };
};
