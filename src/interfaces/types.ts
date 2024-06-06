export interface FunctionDetails {
  function_name: string;
  arguments: any;
}

export interface Step {
  stepId: string;
  description: string;
  toolName: string;
  toolParameters: string[];
}

export interface InputData {
  steps: Step[];
  directResponse: string;
}

export interface ErrorResponse {
  error: string;
  }