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
    console.log('cube name',cubeName)
    // if (cubeName) {
    //   const filePath = path.join(SEMANTIC_LAYER_DIR, `${cubeName}.js`);
    //   const content = await fs.readFile(filePath, 'utf-8');
    //   return `Cube: ${cubeName}\n${content}`;
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
      console.log(`No file found for cube: ${cubeName}`);
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
      // Logger.log('cubeContents',cubeContents)
      return cubeContents.join('\n\n');
    }
  } catch (error) {
    console.error('Error reading cube(s):', error);
    throw error;
  }
}

export async function updateSemanticLayer(updatedContent: string): Promise<void> {
  try {
    // const filePath = path.join(SEMANTIC_LAYER_DIR, 'updated_cube.js');
    // await fs.writeFile(filePath, updatedContent, 'utf-8');

    // console.log('Semantic layer updated successfully');
    
    const files = await fs.readdir(SEMANTIC_LAYER_DIR);
    let fileUpdated = false;
    
    const extractedCubeNames = extractCubeNames(updatedContent)

    const extractCubeContent = separateCubes(updatedContent)
    
    for(const cubeName of extractedCubeNames) {
      for (const file of files) {
        if (path.extname(file) === '.js') {
          const filePath = path.join(SEMANTIC_LAYER_DIR, file);
          const content = await fs.readFile(filePath, 'utf-8');
  
          // Check if this file contains the definition for the cube we're updating
          if (content.includes(`cube(\`${cubeName}\``) || content.includes(`cube('${cubeName}'`) || content.includes(`cube("${cubeName}"`)) {
            // This is the file we need to update
            await fs.writeFile(filePath, updatedContent, 'utf-8');
            console.log(`Semantic layer updated successfully for cube ${cubeName} in file ${file}`);
            fileUpdated = true;
            break;
          }
        }
      }
    }

    // if (!fileUpdated) {
    //   // If we didn't find an existing file for this cube, create a new one
    //   const newFilePath = path.join(SEMANTIC_LAYER_DIR, `${cubeName}.js`);
    //   await fs.writeFile(newFilePath, updatedContent, 'utf-8');
    //   console.log(`New file created for cube ${cubeName}: ${newFilePath}`);
    // }
  } catch (error) {
    console.error('Error updating semantic layer:', error);
    throw error;
  }
}

export async function testValue(task: string, calculationMethod: string): Promise<string> {
  try {
    // In a real-world scenario, you'd run actual tests here.
    // This might involve:
    // 1. Compiling the updated semantic layer
    // 2. Running a test query against a test database
    // 3. Validating the results

    // For this example, we'll simulate a test by running a script
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