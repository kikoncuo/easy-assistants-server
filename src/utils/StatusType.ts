interface NodeError {
  code?: number;
  message: string;
}

interface NodeData {
  message: string;
  payload?: any;
}

export interface NodeStatus {
  type: 'error' | 'data',
  error?: NodeError,
  data?: NodeData
}