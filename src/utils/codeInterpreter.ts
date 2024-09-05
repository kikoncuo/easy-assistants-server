import { CodeInterpreter, ProcessMessage, Sandbox } from '@e2b/code-interpreter';


export async function runCodeInterpret(codeInterpreter: CodeInterpreter, code: string, functions?: Function[]) {
  console.log(`\n${'='.repeat(50)}\n> Running following AI-generated code:\n${code}\n${'='.repeat(50)}`);

  const exec = await codeInterpreter.notebook.execCell(
    code,
    {
      onStdout: (msg: ProcessMessage) => {
        console.log("\n[Code Interpreter stdout]", msg);
        if (functions && functions.length > 0) {
          functions[0]('tool', [{ function_name: 'logStdout', arguments: { message: msg.line } }]);
        }
      },
      onStderr: (msg: ProcessMessage) => {
        console.log("\n[Code Interpreter stderr]", msg);
        if (functions && functions.length > 0) {
          functions[0]('tool', [{ function_name: 'logStderr', arguments: { message: msg.line } }]);
        }
      },
    }
  )

  return exec
}

export async function getCodeInterpreterInstance(timeout: number = 30000): Promise<CodeInterpreter> {
  const codeInterpreter = await CodeInterpreter.create({timeout: timeout}) // If this times out, we ask the user to get on a higher paid omniloy tier
  return codeInterpreter
}