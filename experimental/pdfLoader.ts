import { WebPDFLoader } from "langchain/document_loaders/web/pdf";
import fetch from "node-fetch";
import { groqChatMixtral, getFasterModel } from '../src/models';
import { BaseChatModel} from "@langchain/core/language_models/chat_models";
import { PromptTemplate } from "@langchain/core/prompts";

async function fetchPDF(url: string): Promise<Blob> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return new Blob([buffer], { type: "application/pdf" }) as Blob & { json: () => Promise<any>, formData: () => Promise<any> };
}

async function semanticPDFSplitter(docs: any[], model: BaseChatModel, pagesPerChunk: number, overlapPages: number, fileUrL: string): Promise<any[]> {
    const chunks: any[] = [];

    for (let i = 0; i < docs.length; i += pagesPerChunk - overlapPages) {
        const chunk = docs.slice(i, i + pagesPerChunk);
        const chunkText = chunk.map((doc) => doc.pageContent).join("\n");
        chunks.push({ text: chunkText, pages: chunk });
    }

    const describePromptTemplate = PromptTemplate.fromTemplate(
        `Given the following content text, give a list the contents discussed in the text. You are only seeing a chunk of the document so only describe exactly the contents of your text. 
        You may be seeing incomplete information from an earlier chunk, call that out and describe that information as well.
        If you are seeing a table of contents, disregard it, as you are not seeing the full document and you will see it later.
        Focus on highlighting any key concepts, events, characters, or findings. Keep the description concise to ensure it's quick to read but comprehensive enough to be informative:\n\n Text: {text}`
    );

    const namePromptTemplate = PromptTemplate.fromTemplate(
        `Given the following content text found on URL: {url}, give me a name for it. You are only seeing a chunk of the document so only describe exactly the contents of your text.:\n\n Text: {text}`
    );

    const totalInvokes = chunks.length;
    console.log(`Total invokes needed: ${totalInvokes}`);

    const promises = chunks.map(async (chunk, index) => {
        const describeChain = describePromptTemplate.pipe(model);
        const titleChain = namePromptTemplate.pipe(model);
        console.log(`Invoking ${index + 1}`);
        //const description = (await chain.invoke({ text: chunk.text })).content;
        let description = '';
        let title = '';
        const stream = await describeChain.stream({ text: chunk.text });
        for await (const output of stream.values()) {
            const chunk = output.content.toString();
            description += chunk;
            // console.log(chunk);
        }
        const stream2 = await titleChain.stream({ text: chunk.text, url: fileUrL});
        for await (const output of stream2.values()) {
            const chunk = output.content.toString();
            title += chunk;
            // console.log(chunk);
        }
        console.log(`Invoke ${index + 1} of ${totalInvokes} completed`);
        return {
        description,
        title,
        pages: chunk.pages,
        };
    });

    const result = await Promise.all(promises);
    return result;
}

async function main() {
  const pdfUrl = "https://www.apple.com/newsroom/pdfs/fy2023-q4/FY23_Q4_Consolidated_Financial_Statements.pdf";
  try {
    const pdfBlob = await fetchPDF(pdfUrl);
    const loader = new WebPDFLoader(pdfBlob);
    const docs = await loader.load();

    const groq = groqChatMixtral();
    const gpt35 = getFasterModel(); // we need to use this due to throughput limitations of groq models, will update once they add pricing
    const pagesPerChunk = 10;
    const overlapPages = 1;

    const result = await semanticPDFSplitter(docs, gpt35, pagesPerChunk, overlapPages, pdfUrl);

    console.log("Semantic PDF Splitter Result:");
    result.forEach((item, index) => {
      console.log(`\nChunk ${index + 1}:`);
      console.log("Description:");
      console.log(item.description);
      console.log("Chunk title:");
      console.log(item.title);
      console.log("Pages:");
      item.pages.forEach((page: { pageContent: string; }, pageIndex: number) => {
        console.log(`Page ${pageIndex + 1}:`);
        console.log(page.pageContent);
      });
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

main();