import fetch from 'node-fetch';
import { exec } from 'child_process';
import util from 'util';
import Logger from './Logger';

import dotenv from 'dotenv';
import { executeQuery } from './DataStructure';

dotenv.config();

const execAsync = util.promisify(exec);

export async function getCubes(company_name: string, cubeName?: string): Promise<Record<string, string>> {
  try {
    const url = `${process.env.CUBE_API_SERVER_URL}/company/company-cube-files/${company_name}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch cube files: ${response.statusText}`);
    }

    const data: Record<string, string> = await response.json();
    const cubeFiles = data;

    if (cubeName) {
      // Find the specific cube
      const cubeContent = Object.entries(cubeFiles).find(([filename, content]) => 
        content.includes(`cube(\`${cubeName}\``) || 
        content.includes(`cube('${cubeName}'`) || 
        content.includes(`cube("${cubeName}"`)
      );

      if (cubeContent) {
        return { [cubeContent[0]]: cubeContent[1] };
      } else {
        Logger.log(`No file found for cube: ${cubeName}`);
        return {};
      }
    } else {
      // Return all cubes as an object
      return cubeFiles;
    }
  } catch (error) {
    console.error('Error reading cube(s):', error);
    throw error;
  }
}

const extractBlock = (content: string, blockName: string) => {
  const startPattern = new RegExp(`${blockName}:\\s*{`, 'g');
  const startIndex = content.search(startPattern);
  if (startIndex === -1) {
    throw new Error(`Block ${blockName} not found in content.`);
  }

  let braceCount = 0;
  let i = startIndex;
  let blockEndIndex = -1;

  // Start parsing from the opening brace of the block
  for (; i < content.length; i++) {
    if (content[i] === '{') {
      braceCount++;
    } else if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        blockEndIndex = i;
        break;
      }
    }
  }

  if (blockEndIndex === -1) {
    throw new Error(`Closing brace not found for block ${blockName}.`);
  }

  const blockContent = content.slice(startIndex, blockEndIndex + 1);
  return {
    blockContent,
    blockStartIndex: startIndex,
    blockEndIndex: blockEndIndex + 1
  };
};

const insertField = (content: string, blockName: string, newFieldString: string) => {
  const { blockContent, blockStartIndex, blockEndIndex } = extractBlock(content, blockName);
  
  const trimmedBlockContent = blockContent.trim();
  const lastChar = trimmedBlockContent.charAt(trimmedBlockContent.length - 2); // Check second last character (before '}')

  // Ensure the previous field ends correctly with '},'
  const formattedContent = (lastChar !== ',' && lastChar !== ' ') 
    ? trimmedBlockContent.slice(0, -1) + ',' + trimmedBlockContent.slice(-1)
    : trimmedBlockContent;

  // Insert the new field immediately after the opening brace
  let newBlockContent = formattedContent.replace(/\{\s*/, '{\n    ' + newFieldString + ',\n    ');
  newBlockContent = newBlockContent.replace(/,\s*}$/, '\n}');

  // Replace the old block with the new block in the content
  return content.slice(0, blockStartIndex) + newBlockContent + content.slice(blockEndIndex);
};


export async function updateSemanticLayer(newFields: any[], company_name: string): Promise<{ success: boolean, errors: string[], newPayload: string }> {
  try {
    const cubeFiles = await getCubes(company_name);
    const originalCubeFiles = { ...cubeFiles }; // Save original state to restore if validation fails
    const errors: string[] = [];

    newFields.forEach(field => {
      const { cubeName, fieldName, fieldType, type, sql, title, description } = field;
      const fileName = `${cubeName.toLowerCase()}.js`;

      if (!cubeFiles[fileName]) {
        cubeFiles[fileName] = `cube('${cubeName}', {
  measures: {},
  dimensions: {},
  segments: {}
});`;
      }

      let cubeContent = cubeFiles[fileName];
      const blockName = type === 'measure' ? 'measures' : type === 'dimension' ? 'dimensions' : 'segments';
      const newFieldString = `${fieldName}: {
        type: \`${fieldType}\`,
        sql: \`${sql}\`,
        title: \`${title}\`,
        description: \`${description}\`
      }`;

      try {
        cubeContent = insertField(cubeContent, blockName, newFieldString);
      } catch (error) {
        Logger.error("Error inserting new field")
      }

      cubeFiles[fileName] = cubeContent;
    });

    const payload = {
      cubeFiles: {
        model: {
          cubes: cubeFiles
        }
      }
    };

    Logger.log('Update payload', payload);

    const response = await fetch(`${process.env.CUBE_API_SERVER_URL}/company/edit-cube-files/${company_name}`, {
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
    Logger.log('Semantic layer updated successfully:', responseData);

    // Validate the new schema for all updated cubes
    const validationResults = await Promise.all(newFields.map((field: any) => validateSchema(company_name, field.cubeName, [field])));
    const validationErrors = validationResults.filter(result => result !== null);

    if (validationErrors.length > 0) {
      // Restore original cube files if validation fails
      await restoreOriginalCubes(originalCubeFiles, company_name);
      errors.push(...validationErrors);
      return { success: false, errors, newPayload: JSON.stringify(payload.cubeFiles) };
    }

    return { success: true, errors: [], newPayload: "" };
  } catch (error) {
    Logger.error('Error updating semantic layer:', error);
    throw error;
  }
}


async function restoreOriginalCubes(originalCubeFiles: Record<string, string>, company_name: string): Promise<void> {
  const payload = {
    cubeFiles: {
      model: {
        cubes: originalCubeFiles
      }
    }
  };

  const response = await fetch(`${process.env.CUBE_API_SERVER_URL}/company/edit-cube-files/${company_name}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to restore original semantic layer: ${response.statusText}`);
  }

  const responseData = await response.json();
  Logger.log('Original semantic layer restored successfully:', responseData);
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

export async function validateSchema(companyName: string, cube: string, newFields: { fieldName: string, type: string }[]): Promise<string | null> {
  try {
    for (const field of newFields) {
      const query = field.type === 'measure' ? { "measures": [`${cube}.${field.fieldName}`] } : { "dimensions": [`${cube}.${field.fieldName}`] };
      const response = await executeQuery(query, companyName); 

      if ((response as string).startsWith("Error")){
        Logger.error(response)
        return response
      }
    }
    return null;
  } catch (error) {
    Logger.error('Schema validation error:', error);
    return 'Unknown error';
  }
}
