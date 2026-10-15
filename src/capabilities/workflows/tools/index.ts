import listWorkflows from "./list_workflows";
import getWorkflow from "./get_workflow";
import createWorkflow from "./create_workflow";
import updateWorkflow from "./update_workflow";
import deleteWorkflow from "./delete_workflow";
import addNode from "./add_node";
import updateNode from "./update_node";
import deleteNode from "./delete_node";
import reorderNodes from "./reorder_nodes";
import runWorkflow from "./run_workflow";

export const tools = [
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  addNode,
  updateNode,
  deleteNode,
  reorderNodes,
  runWorkflow,
];
