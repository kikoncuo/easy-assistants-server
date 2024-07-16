// File: ../utils/SemanticLayer.ts

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import Logger from './Logger';
import { extractCubeNames, separateCubes } from '../../tests/helpers';

const execAsync = util.promisify(exec);

const SEMANTIC_LAYER_DIR = path.join(__dirname, '..', '..', 'semantic_layer');

export async function getCubes(cubeName?: string): Promise<string> {
  try {
    Logger.log('cube name',cubeName)
    if (cubeName) {
      const files = await fs.readdir(SEMANTIC_LAYER_DIR);
      
      // Find the file that contains the cube definition
      for (const file of files) {
        if (path.extname(file) === '.js') {
          const filePath = path.join(SEMANTIC_LAYER_DIR, file);
          const content = await fs.readFile(filePath, 'utf-8');
          
          // Check if the file contains the cube definition
          if (content.includes(`cube(\`${cubeName}\``) || content.includes(`cube('${cubeName}'`) || content.includes(`cube("${cubeName}"`)) {
            return `Cube: ${cubeName}\n${content}`;
          }
        }
      }
      
      // If no matching file is found
      Logger.log(`No file found for cube: ${cubeName}`);
      return '';
    } else {
      const files = await fs.readdir(SEMANTIC_LAYER_DIR);
      Logger.log('files',files)
      const cubeContents = await Promise.all(
        files
          .filter(file => file.endsWith('.js'))
          .map(async file => {
            const content = await fs.readFile(path.join(SEMANTIC_LAYER_DIR, file), 'utf-8');
            return `Cube: ${path.basename(file, '.js')}\n${content}`;
          })
      );
      return cubeContents.join('\n\n');
    }
  } catch (error) {
    console.error('Error reading cube(s):', error);
    throw error;
  }
}

export async function updateSemanticLayer(updatedContent: string): Promise<void> {
  try {

    const files = await fs.readdir(SEMANTIC_LAYER_DIR);
let fileUpdated = false;
const extractedCubeNames = extractCubeNames(updatedContent);
const extractedCubeContent = separateCubes(updatedContent);

for (let i = 0; i < extractedCubeNames.length; i++) {
  const cubeName = extractedCubeNames[i];
  const cubeContent = extractedCubeContent[i];
  
  for (const file of files) {
    if (path.extname(file) === '.js') {
      const filePath = path.join(SEMANTIC_LAYER_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Check if this file contains the definition for the cube we're updating
      if (content.includes(`cube(\`${cubeName}\``) || 
          content.includes(`cube('${cubeName}'`) || 
          content.includes(`cube("${cubeName}"`)) {
        
        // This is the file we need to update
        // Replace the old cube content with the new cube content
        const updatedFileContent = content.replace(
          /cube\([`'"](${cubeName})[`'"]\s*,\s*{[\s\S]*?}\s*\)\s*;?/,
          cubeContent
        );
        
        await fs.writeFile(filePath, updatedFileContent, 'utf-8');
        console.log(`Semantic layer updated successfully for cube ${cubeName} in file ${file}`);
        fileUpdated = true;
        break;
      }
    }
  }
  
  if (!fileUpdated) {
    console.log(`No existing file found for cube ${cubeName}. Creating a new file.`);
    const newFilePath = path.join(SEMANTIC_LAYER_DIR, `${cubeName}.js`);
    await fs.writeFile(newFilePath, cubeContent, 'utf-8');
    fileUpdated = true;
  }
  
  fileUpdated = false; // Reset for the next cube
}

  } catch (error) {
    console.error('Error updating semantic layer:', error);
    throw error;
  }
}

export async function testValue(task: string, calculationMethod: string): Promise<string> {
  try {
    const testScript = `
      console.log('Testing task: ${task}');
      console.log('Calculation method: ${calculationMethod}');
      console.log('Test passed successfully');
    `;

    const { stdout, stderr } = await execAsync(`node -e "${testScript}"`);

    if (stderr) {
      console.error('Test error:', stderr);
      return `Test failed: ${stderr}`;
    }

    return stdout;
  } catch (error) {
    console.error('Error testing value:', error);
    throw error;
  }
}