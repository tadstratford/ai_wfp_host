import { WFP_API, Result, ToolDefinition } from '@backend/core/wfp';

/**
 * Workflow End Tool
 * Marks the end of a workflow execution path. No-op aside from a status message.
 */
export const Tool_run = async (api: WFP_API): Promise<Result> => {
    const outputValue = api.getParameter('outputValue');
    api.addMessage({
        role: 'tool',
        markdown: `✓ **Workflow complete.**${outputValue ? `\n\nOutput: ${outputValue}` : ''}`,
    });
    return {
        status: 'success',
        statusMessage: 'Workflow completed',
    };
};

export const tool_definition = async (): Promise<ToolDefinition> => {
    return {
        tool_id: 'workflow_end',
        name: 'Workflow End',
        apiVersion: '1.0.0',
        description: 'Exit point for the workflow. Defines the final output.',
        description_md: `## What it does
Marks the end of a workflow execution path. Displays a completion message in the session chat confirming the workflow finished successfully.

## Inputs
- **outputValue** — optional message shown in the completion banner (default: "Done")

## Outputs
None. This is a terminal node.

## Notes
Every workflow must end with this node. A workflow without an end node will hang.`,
        category: 'flow',

        inputs: [
            {
                name: 'outputValue',
                type: 'string',
                value: 'Done',
                required: false
            }
        ],
        outputs: [],


    };
};
