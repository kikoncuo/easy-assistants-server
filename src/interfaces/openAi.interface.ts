
export type MessageCreationStepDetails = {
    message_creation: {
      message_id: string;
    };
  };
  
export type ToolCallsStepDetails = {
    tool_calls: Array<{
      type: string;
      code_interpreter?: any; // Replace 'any' with a more specific type if available
      // Add other tool call types if needed
    }>;
  };
  
  type RunStep = {
    step_details: MessageCreationStepDetails | ToolCallsStepDetails;
    thread_id: string;
    type: 'message_creation' | 'tool_calls';
    usage: any | null; // Replace 'any' with a more specific type if available
  };
  
  type RunState = {
    status: string;
    steps: RunStep[];
  };
  
  export interface TextContentBlock {
    text: Text;
  
    /**
     * Always `text`.
     */
    type: 'text';
  }
  
  export interface ImageFile {
    /**
     * The [File](https://platform.openai.com/docs/api-reference/files) ID of the image
     * in the message content. Set `purpose="vision"` when uploading the File if you
     * need to later display the file content.
     */
    file_id: string;
  
    /**
     * Specifies the detail level of the image if specified by the user. `low` uses
     * fewer tokens, you can opt in to high resolution using `high`.
     */
    detail?: 'auto' | 'low' | 'high';
  }
  
  export interface ImageURL {
    /**
     * The external URL of the image, must be a supported image types: jpeg, jpg, png,
     * gif, webp.
     */
    url: string;
  
    /**
     * Specifies the detail level of the image. `low` uses fewer tokens, you can opt in
     * to high resolution using `high`. Default value is `auto`
     */
    detail?: 'auto' | 'low' | 'high';
  }
  
  export interface ImageFileContentBlock {
    image_file: ImageFile;
  
    /**
     * Always `image_file`.
     */
    type: 'image_file';
  }
  
  export interface ImageURLContentBlock {
    image_url: ImageURL;
  
    /**
     * The type of the content part.
     */
    type: 'image_url';
  }
  
  export interface RefusalContentBlock {
    refusal: string;
  
    /**
     * Always `refusal`.
     */
    type: 'refusal';
  }
  
  // Assuming `MessageContent` is a union of these types:
  export type MessageContent =
    | ImageFileContentBlock
    | ImageURLContentBlock
    | TextContentBlock
    | RefusalContentBlock;
  
  export interface Text {
  
    /**
     * The data that makes up the text.
     */
    value: string;
  }


export function isMessageCreationStepDetails(
    stepDetails: MessageCreationStepDetails | ToolCallsStepDetails
  ): stepDetails is MessageCreationStepDetails {
    return 'message_creation' in stepDetails;
  }
  
export function isToolCallsStepDetails(
    stepDetails: MessageCreationStepDetails | ToolCallsStepDetails
  ): stepDetails is ToolCallsStepDetails {
    return 'tool_calls' in stepDetails;
  }