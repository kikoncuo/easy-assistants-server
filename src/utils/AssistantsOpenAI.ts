import { Parser } from 'json2csv';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import Logger from './Logger';
import { isMessageCreationStepDetails, isToolCallsStepDetails, ToolCallsStepDetails } from '../interfaces/openAi.interface';

const openai = new OpenAI();

const uploadCSVToOpenAI = async (csvContent: string, tableName: string) => {
  // Create a Blob from the CSV content
  const blob = new Blob([csvContent], { type: 'text/csv' });

  // Convert the Blob to a File object
  const file = new File([blob], `${tableName}.csv`, { type: 'text/csv' });

  // Upload the file to OpenAI using the official client library
  const uploadedFile = await openai.files.create({
    file: file,
    purpose: 'assistants',
  });

  Logger.log(`File uploaded successfully for table ${tableName}:`);
  return uploadedFile.id;
};

export const parseAndUploadTables = async (data: any): Promise<OpenAI.Beta.Threads.Messages.MessageCreateParams.Attachment[]> => {
  const attachments: OpenAI.Beta.Threads.Messages.MessageCreateParams.Attachment[] = [];

  for (const table of data) {
    if (!table.columns.length || !table.rows.length) {
      Logger.warn(`Skipping empty table: ${table.tableName}`);
      continue;
    }
    Logger.log(`Uploading table ${table.tableName} to OpenAI...`);
    // Convert rows to an array of objects based on column names
    const rows = table.rows.map((row: any[]) => {
      return table.columns.reduce((acc: any, col: string, index: number) => {
        acc[col] = row[index];
        return acc;
      }, {});
    });

    // Convert JSON to CSV
    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(rows);
    // Upload CSV content to OpenAI and collect the file ID
    const fileId = await uploadCSVToOpenAI(csv, table.tableName);
    
    // Create an attachment object for this file
    const attachment: OpenAI.Beta.Threads.Messages.MessageCreateParams.Attachment = {
      file_id: fileId,
      tools: [{ type: "code_interpreter" }]
    };
    
    attachments.push(attachment);
  }

  return attachments;
};

export const uploadTables = async (data: { [tableName: string]: string }): Promise<OpenAI.Beta.Threads.Messages.MessageCreateParams.Attachment[]> => {
  const attachments: OpenAI.Beta.Threads.Messages.MessageCreateParams.Attachment[] = [];

  for (const [tableName, csvContent] of Object.entries(data)) {
    if (!csvContent) {
      Logger.warn(`Skipping table with missing CSV content: ${tableName}`);
      continue;
    }
    
    Logger.log(`Uploading table ${tableName} to OpenAI...`);
    
    // Upload CSV content to OpenAI and collect the file ID
    const fileId = await uploadCSVToOpenAI(csvContent, tableName);
    
    // Create an attachment object for this file
    const attachment: OpenAI.Beta.Threads.Messages.MessageCreateParams.Attachment = {
      file_id: fileId,
      tools: [{ type: "code_interpreter" }]
    };
    
    attachments.push(attachment);
  }

  return attachments;
};



// Function to delete any old files older than 24 hours
const checkAndDeleteOldFiles = async () => {
  try {
    //const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const fileList = await openai.files.list();

    for (const file of fileList.data) {
      if (file.created_at < tenMinutesAgo) {
        Logger.log(`Deleting old file: ${file.filename} (ID: ${file.id})`);
        await openai.files.del(file.id);
      }
    }
  } catch (error) {
    Logger.error('Error checking and deleting old files:', error);
  }
};

export const createThread = async (): Promise<string> => {
  const thread = await openai.beta.threads.create();
  Logger.log("New conversation, created thread: ", thread);
  return thread.id;
};

export const createMessage = async (
  threadId: string, 
  content: string, 
  attachments: OpenAI.Beta.Threads.Messages.MessageCreateParams.Attachment[]
) => {
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content,
    attachments
  });
};

// For furure use, when we want to run this elsewhere https://community.openai.com/t/get-just-the-code-from-code-interpreter-without-running-the-code/490501/5
export const streamRun = async (
  threadId: string, 
  assistantId: string,
  onToolCallDone: (tool: any, image:any, status:string, runId: string) => void,
  onTextDone: (content: any, status:string, runId: string) => void,
  onError: (error: any) => void,
): Promise<void> => {

  try {
  const run = openai.beta.threads.runs.stream(threadId, { assistant_id: assistantId })
    .on('connect',() => {
      console.log('connected')
    })
    .on('runStepDone', async(runStep) => {
      try {
        const stepDetails = runStep.step_details;
        const status = await openai.beta.threads.runs.retrieve(threadId, runStep.run_id);
        if (isMessageCreationStepDetails(stepDetails)) {
          const messageDetails = stepDetails.message_creation;
          const message = await openai.beta.threads.messages.retrieve(threadId, messageDetails.message_id);
          for (const content of message.content) {
            if (content.type === 'text') {
              onTextDone(content.text, status.status, runStep.run_id);
            }
          }
        } else if (isToolCallsStepDetails(stepDetails)) {
          if (stepDetails.type === 'tool_calls' && stepDetails.tool_calls[0]?.type === 'code_interpreter') {
            let imageDataBuffer: Buffer | null = null;

            if (stepDetails.tool_calls[0].code_interpreter.outputs && stepDetails.tool_calls[0].code_interpreter.outputs.length > 0) {
              for (const output of stepDetails.tool_calls[0].code_interpreter.outputs) {
                if (output.type === 'image') {
                  const imageId = output.image.file_id;

                  // Fetch the image asynchronously
                  const response = await openai.files.content(imageId);
                  const imageData = await response.arrayBuffer();
                  imageDataBuffer = Buffer.from(imageData); // Assign image data to buffer
                  break; 
                }
              }
            }

            // Pass both code and image data to onToolCallDone
            onToolCallDone(stepDetails.tool_calls[0].code_interpreter, imageDataBuffer, status.status, runStep.run_id);
            }
          }
        } catch (error) {
          console.error('Error during runStep processing:', error);
        }
      }).on('end', () => {
        console.log('ended');
      }).on('error', (error) => {
        // Handle errors from the stream here
        console.error('Stream encountered an error:', error);
        onError(error);
      });
  } catch (error) {
    console.error('Error initializing run stream:', error);
  }
     // Here are more events if in the future we want to stream more often
      /*.on('textCreated', (text) => process.stdout.write('\nassistant > '))
      .on('textDelta', (textDelta, snapshot) => {
        if (textDelta.value !== undefined) {
          process.stdout.write(textDelta.value);
        }
      })*/
      //.on('toolCallCreated', (toolCall) => process.stdout.write(`\nassistant > ${toolCall.type}\n\n`))
      /*.on('toolCallDelta', (toolCallDelta, snapshot) => {
        if (toolCallDelta.type === 'code_interpreter' && toolCallDelta.code_interpreter) {
          if (toolCallDelta.code_interpreter.input) {
            process.stdout.write(toolCallDelta.code_interpreter.input);
          }
          if (toolCallDelta.code_interpreter.outputs) {
            process.stdout.write("\noutput >\n");
            Logger.log('outputs', toolCallDelta)
            Logger.log('snapshot', snapshot)
            toolCallDelta.code_interpreter.outputs.forEach(output => {
              if (output.type === "logs") {
                process.stdout.write(`\n${output.logs}\n`);
              }
            });
            Logger.log('outputs', toolCallDelta)
            Logger.log('snapshot', snapshot)
          }
        } else {
          process.stdout.write(`\n\nUNKNOWN TYPE > ${toolCallDelta.type}\n\n`);
          process.stdout.write(JSON.stringify(toolCallDelta, null, 2));
        }
      });*/
};

export const saveOpenAIImage = async (imageId: string): Promise<string> => {
  try {
    
    const outputDir = path.join(__dirname, '..', '..', 'output', 'images'); // For testing, do not push this
    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Retrieve the image data from OpenAI
    const response = await openai.files.content(imageId);

    // Extract the binary data from the Response object
    const imageData = await response.arrayBuffer();

    // Convert the binary data to a Buffer
    const imageDataBuffer = Buffer.from(imageData);

    // Generate a unique filename
    const filename = `openai_image_${imageId}_${Date.now()}.png`;
    const filePath = path.join(outputDir, filename);

    // Save the image to the specified location
    fs.writeFileSync(filePath, imageDataBuffer);

    Logger.log(`Image saved successfully: ${filePath}`);
    return filePath;
  } catch (error) {
    Logger.error(`Error saving OpenAI image (ID: ${imageId}):`, error);
    throw error;
  }
};

// Polling version
export const pollRun = async (
  threadId: string,
  assistantId: string,
  onToolCallDone: (tool: any) => void,
  onImageFileDone: (content: any, snapshot: any) => void,
  onTextDone: (content: any, snapshot: any) => void,
  pollInterval: number = 1000, // Poll every 1 second by default
  maxAttempts: number = 60 // Maximum number of polling attempts (1 minute by default)
): Promise<void> => {
  const run = await openai.beta.threads.runs.create(threadId, { assistant_id: assistantId });
  let attempts = 0;
  while (attempts < maxAttempts) {
    const runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);

    if (runStatus.status === 'completed') {
      const runSteps = await openai.beta.threads.runs.steps.list(threadId, run.id);
      
      for (const step of runSteps.data) {
        if (step.type === 'message_creation') {
          const  stepDetails = step.step_details;
          if (isMessageCreationStepDetails(stepDetails)) {
            const messageDetails = stepDetails.message_creation;
            const message = await openai.beta.threads.messages.retrieve(threadId, messageDetails.message_id);
            for (const content of message.content) {
              if (content.type === 'text') {
                onTextDone(content.text.value, { run_id: run.id });
              } else if (content.type === 'image_file') {
                onImageFileDone(content, { run_id: run.id });
              }
            }
          } else {
            console.error("step_details does not contain message_creation details.");
          }
        } else if (step.type === 'tool_calls') {
          const toolCallsDetails = step.step_details as ToolCallsStepDetails;
          for (const toolCall of toolCallsDetails.tool_calls) {
            if (toolCall.type === 'code_interpreter' && toolCall.code_interpreter) {
              onToolCallDone(toolCall.code_interpreter);
            }
            // Add handling for other tool types if needed
          }
        }
      }
      return;
    } else if (runStatus.status === 'failed') {
      throw new Error(`Run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
    attempts++;
  }

  throw new Error('Run timed out');
};

// Function to schedule the file check
const scheduleFileCheck = () => {
  // Run immediately on startup
  checkAndDeleteOldFiles();

  // Schedule to run every 24 hours
  setInterval(checkAndDeleteOldFiles, 24 * 60 * 60 * 1000);
//   setInterval(checkAndDeleteOldFiles, 10 * 60 * 1000);

};

scheduleFileCheck();