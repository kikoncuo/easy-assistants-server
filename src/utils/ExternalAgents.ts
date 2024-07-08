import { anthropicSonnet, createAgent } from "../models/Models";
import { createTableStructure } from "../models/Tools";

export const externalAgents = {
    csvLoader: {
      agent: createAgent(anthropicSonnet(), [createTableStructure]),
      agentPrompt: `You are an LLM specialized in the entire process of transforming JSON data into a fully functional PostgreSQL. This is done by using your createTableStructure tool to create the table. This should return the column name followed by the data type of that column.
        If you detect any date column return it as a type text.
        Column names should never include whitespaces, but rather underscore for separating words, ensure there are no whitespaces in the items inside columns array.
        Always respond using the tool`,
    }
  };