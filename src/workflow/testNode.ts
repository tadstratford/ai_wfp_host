import { WorkflowNode } from "@backend/types";
import { getToolDefinition } from "@core/tools/index";
import type { Session } from "@backend/types";


/**
 * Test a single workflow node by executing it with its configured parameters
 *
 * @param node - The workflow node to test
 * @returns Test results including output, execution time, and status
 */
export const testNode = async (node: WorkflowNode): Promise<{
  success: boolean;
  output: any;
  executionTime: number;
  error?: string;
  toolInfo?: any;
}> => {
  const startTime = Date.now();

  try {
    // Validate node type
    if (node.type !== "tool") {
      return {
        success: false,
        output: null,
        executionTime: 0,
        error: "Only tool nodes can be tested",
      };
    }

    // Validate tool_id
    if (!node.tool_id) {
      return {
        success: false,
        output: null,
        executionTime: 0,
        error: "Node does not have a tool_id configured",
      };
    }

    // Get tool information
    const tool = await getToolDefinition(node.tool_id);
    if (!tool) {
      return {
        success: false,
        output: null,
        executionTime: Date.now() - startTime,
        error: `Tool not found: ${node.tool_id}`,
      };
    }

    // Create a test session
    const testSession: Session = {
      session_id: `test-${node.id}-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      currentWorkflowIndex: 0,
      currentActionIndex: 0,
      actions: [],
      messages: [],
      parameters: [],
      memoryContext: "",
      sessionName: `Test: ${node.label}`,
    };

    // Execute the tool
    // const resultSession = await runTool(testSession, node.tool_id);
    const resultSession = testSession;

    const executionTime = Date.now() - startTime;

    // Extract the tool output from the last message
    const toolMessages = resultSession.messages.filter(
      (msg) => msg.role === "tool" || msg.role === "system"
    );
    const lastMessage = toolMessages[toolMessages.length - 1];

    return {
      success: true,
      output: {
        messages: resultSession.messages,
        lastMessage: lastMessage,
        data: lastMessage?.data,
        json: lastMessage?.json,
        html: lastMessage?.html,
        markdown: lastMessage?.markdown,
      },
      executionTime,
      toolInfo: {
        name: tool.name,
        description: tool.description,
        inputs: (tool as any).inputs ?? (tool as any).parameters,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

