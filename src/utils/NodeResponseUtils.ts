interface NodeError {
  code?: number;
  message: string;
}

interface NodeData {
  message: string;
  data?: any;
}

export interface NodeStatus {
  type: 'error' | 'data',
  payload: NodeError | NodeData
}

export function createNodeResponse(type: 'error' | 'data', payload: NodeError | NodeData) {
  const status: NodeStatus = {
    type,
    payload
  }
  return status;
}