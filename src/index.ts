// index.ts
import readline from 'readline'; // Used for demo purposes
import { GraphManager } from './LangraphReWoo';
import { getStrongestModel, getFasterModel, groqChatMixtral, anthropicSonnet, createAgent } from './models';
import { calculatorTool, emailTool, filterTool, eventTool, rewardTool } from './tools'; // Assuming you have a similar TypeScript class for CustomCalculatorTool


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});



class GraphApplication {
    private graphManager: GraphManager;
    private outputHandler: (type: string, message: string) => void;

    constructor(outputHandler: (type: string, message: string) => void = console.log, agentFunction: Function) {
        this.outputHandler = outputHandler;

        const strongestModel = getStrongestModel();
        const fasterModel = getFasterModel();
        const groqModel = groqChatMixtral();
        const anthropicModel = anthropicSonnet();

        const agents = {
          "calculate": {agent: createAgent(fasterModel, [calculatorTool]), agentPrompt:"You are an LLM specialized on math operations with access to a calculator tool."},
          "createCampaing" : {agent: createAgent(fasterModel, [emailTool, rewardTool, filterTool, eventTool]), agentPrompt:"You are an LLM specialized on creating campaings, in order to create a campaing you will need to call all your tools once to get all the components of a campaign"}
      };


        this.graphManager = new GraphManager(
            strongestModel,
            agents,
            fasterModel,
            outputHandler,
            agentFunction
        );
    }

    async processTask(task: string) {
        const finalResult = await this.graphManager.getApp().invoke({ task });
        if (finalResult) {
            this.outputHandler('result', finalResult.result); // Assuming finalResult structure has a result property
        }
    }
}

const customOutputHandler = (type: string, message: string) => { // This is a simplified version of the function for demo purposes, it only handles one tool at the time
    console.log(`${type}: ${message}`);
};


const queryUser = async (type: string, functions: Array<{ function_name: string; arguments: any }>) => { // This is a simplified version of the function for demo purposes, it only handles one tool at the time
    console.log(`Querying user for ${type} with function:`, functions[0]);
  
    const { function_name, arguments: args } = functions[0];
    console.log(`Function: ${function_name}`);
  
    const userInput = await new Promise<string>((resolve) => {
      const prompt = Object.entries(args)
        .map(([key, value]: [string, any]) => {
          const description = value.description || '';
          return `${key} (${value.type}): ${description}\n`;
        })
        .join('');
  
      rl.question(prompt, (input) => {
        resolve(input);
      });
    });
  
    return userInput;
  };

(async () => {
    const graphApp = new GraphApplication(customOutputHandler, queryUser);
    const task = "What's 5 to the power of 2 multiplied by the square root of 7?";
    console.log("Processing task:", task);
    await graphApp.processTask(task);
    rl.close();
})();
