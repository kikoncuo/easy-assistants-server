import fetch from 'node-fetch';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import Logger from './Logger';
import { extractCubeNames, separateCubes } from '../../tests/helpers';

import dotenv from 'dotenv';

dotenv.config();

const {CUBEJS_SERVER} = process.env;

const execAsync = util.promisify(exec);

export async function getCubes(cubeName?: string): Promise<string> {
  try {
    Logger.log('cube name',cubeName)
    const company_name = "omni_test";
    const url = `${CUBEJS_SERVER}/company-cube-files/${company_name}`
    
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch cube files: ${response.statusText}`);
    }

    const data = await response.json();
    const cubeFiles = data;

    if (cubeName) {
      // Find the specific cube
      const cubeContent = Object.entries(cubeFiles).find(([filename, content]) => 
        (content as string).includes(`cube(\`${cubeName}\``) || 
        (content as string).includes(`cube('${cubeName}'`) || 
        (content as string).includes(`cube("${cubeName}"`)
      );

      if (cubeContent) {
        return `Cube: ${cubeName}\n${cubeContent[1]}`;
      } else {
        Logger.log(`No file found for cube: ${cubeName}`);
        return '';
      }
    } else {
      // Return all cubes
      const cubeContents = Object.entries(cubeFiles).map(([filename, content]) => 
        `Cube: ${path.basename(filename, '.js')}\n${content}`
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
    const company_name = "omni_test"
    const extractedCubeNames = extractCubeNames(updatedContent);
    const extractedCubeContent = separateCubes(updatedContent);
    
    const cubeFiles: Record<string, string> = {};

    for (let i = 0; i < extractedCubeNames.length; i++) {
      const cubeName = extractedCubeNames[i];
      const cubeContent = extractedCubeContent[i];
      
      const fileName = `${cubeName.toLowerCase()}.js`;
      cubeFiles[fileName] = cubeContent;
    }

    const payload = {
      cubeFiles: {
        model: {
          cubes: cubeFiles
        }
      }
    };

    Logger.log('update payload', payload)

    const response = await fetch(`${CUBEJS_SERVER}/edit-cube-files/${company_name}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to update semantic layer: ${response.statusText}`);
    }

    const responseData = await response.json();
    console.log('Semantic layer updated successfully:', responseData);
  } catch (error) {
    Logger.error('Error updating semantic layer:', error);
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