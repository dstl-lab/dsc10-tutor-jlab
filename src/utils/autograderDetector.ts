import { ICellModel } from '@jupyterlab/cells';

import { logAutograderEvent } from './autograderLogger';

/**
 * Detects if a cell execution is an autograder run
 * Checks for common autograder patterns like otter.check(), grader.check(), ok.grade()
 */
export function isAutograderExecution(
  cell: ICellModel
): { isGrader: boolean; graderId?: string } {
  const source = cell.sharedModel?.source || '';
  const sourceStr = Array.isArray(source) ? source.join('') : source;

  // Pattern 1: Otter Grader - otter.check('question_id')
  const otterPattern = /otter\.check\(['"]([^'"]+)['"]\)/;
  const otterMatch = sourceStr.match(otterPattern);
  if (otterMatch) {
    return { isGrader: true, graderId: otterMatch[1] };
  }

  // Pattern 2: Generic grader - grader.check('question_id')
  const graderPattern = /grader\.check\(['"]([^'"]+)['"]\)/;
  const graderMatch = sourceStr.match(graderPattern);
  if (graderMatch) {
    return { isGrader: true, graderId: graderMatch[1] };
  }

  // Pattern 3: OKPy - ok.grade('question_id')
  const okPattern = /ok\.grade\(['"]([^'"]+)['"]\)/;
  const okMatch = sourceStr.match(okPattern);
  if (okMatch) {
    return { isGrader: true, graderId: okMatch[1] };
  }

  return { isGrader: false };
}

/**
 * Extracts grader output and determines success/failure
 * Handles all Jupyter output types: errors, streams, display data
 * Also handles JupyterLab model objects (IOutputModel) which use different property names
 */
export function parseGraderOutput(output: any): {
  output: string;
  success: boolean;
} {
  let outputText = '';
  let success = false;

  if (!output) {
    return { output: '', success: false };
  }

  // Helper to convert array to string
  const arrayToString = (val: any): string => {
    if (Array.isArray(val)) {
      return val.join('');
    }
    return String(val || '');
  };

  if (typeof output === 'object') {
    // JupyterLab model objects use 'type' instead of 'output_type'
    // and store raw data in '_raw' or '_rawData'
    // First, try to get the actual data from model objects
    let actualOutput = output;
    if (output._raw) {
      actualOutput = output._raw;
    } else if (output._rawData) {
      actualOutput = output._rawData;
    }
    
    // Check both 'type' (model) and 'output_type' (raw JSON)
    const outputType = output.type || actualOutput.output_type || actualOutput.type;
    
    // Handle error outputs (NameError, ValueError, etc.)
    if (outputType === 'error') {
      const errorName = actualOutput.ename || output.ename || '';
      const errorValue = actualOutput.evalue || output.evalue || '';
      const traceback = actualOutput.traceback || output.traceback || [];
      
      // Build full error message from traceback
      if (Array.isArray(traceback) && traceback.length > 0) {
        // Join traceback lines, handling both string and array formats
        outputText = traceback
          .map((line: any) => (Array.isArray(line) ? line.join('') : String(line)))
          .join('\n');
      }
      
      // If no traceback or empty, use error name and value
      if (!outputText) {
        outputText = `${errorName}: ${errorValue}`;
      }
      
      success = false;
    }
    // Handle stream outputs (stdout/stderr)
    else if (outputType === 'stream') {
      const streamName = actualOutput.name || output.name || ''; // 'stdout' or 'stderr'
      outputText = arrayToString(actualOutput.text || output.text || output._text);
      
      // Add stream name prefix if stderr
      if (streamName === 'stderr' && outputText) {
        outputText = `[stderr] ${outputText}`;
      }
      
      // Stream outputs are typically neutral, check content for success/failure
      const outputLower = outputText.toLowerCase();
      success = !outputLower.includes('error') && !outputLower.includes('failed');
    }
    // Handle display data (execute_result, display_data)
    else if (actualOutput.data || output.data) {
      const data = actualOutput.data || output.data;
      // Try different mime types in order of preference
      outputText =
        arrayToString(data['text/plain']) ||
        arrayToString(data['text/html']) ||
        arrayToString(data['text/markdown']) ||
        arrayToString(data['text/latex']) ||
        '';
      
      // Check for success indicators
      const outputLower = outputText.toLowerCase();
      success =
        outputLower.includes('all tests passed') ||
        outputLower.includes('test passed') ||
        outputLower.includes('passed!') ||
        outputLower.includes('✓') ||
        (outputLower.includes('passed') &&
          !outputLower.includes('failed') &&
          !outputLower.includes('error'));
    }
    // Handle text output directly (check both model and raw properties)
    else if (output._text !== undefined || output.text !== undefined || actualOutput.text !== undefined) {
      outputText = arrayToString(output._text || output.text || actualOutput.text);
      
      const outputLower = outputText.toLowerCase();
      success =
        outputLower.includes('all tests passed') ||
        outputLower.includes('test passed') ||
        outputLower.includes('passed!') ||
        (!outputLower.includes('failed') &&
          !outputLower.includes('error') &&
          outputLower.includes('passed'));
    }
    // Last resort: try to serialize the entire output object
    else {
      // Try to extract any meaningful text from the object
      try {
        // Try to get the raw JSON representation if it's a model object
        const rawJson = output.toJSON ? output.toJSON() : actualOutput;
        outputText = JSON.stringify(rawJson, null, 2);
      } catch (e) {
        outputText = String(output);
      }
      success = false; // Unknown format, assume failure
    }
  } else if (typeof output === 'string') {
    outputText = output;
    const outputLower = outputText.toLowerCase();
    success =
      outputLower.includes('all tests passed') ||
      outputLower.includes('test passed') ||
      outputLower.includes('passed!') ||
      (!outputLower.includes('failed') &&
        !outputLower.includes('error') &&
        outputLower.includes('passed'));
  } else {
    // Fallback: convert to string
    outputText = String(output);
    success = false;
  }

  return {
    output: outputText.trim(),
    success
  };
}

/**
 * Handles autograder execution and logs the event
 */
export async function handleAutograderExecution(
  cell: ICellModel,
  outputs: any[]
): Promise<void> {
  const detection = isAutograderExecution(cell);
  if (!detection.isGrader) {
    return;
  }

  const graderId = detection.graderId || 'unknown';

  // Collect all output from the cell execution
  let fullOutput = '';
  let hasError = false;

  console.log('🔍 Processing outputs:', { outputsCount: outputs.length });
  
  // If no outputs, log warning
  if (outputs.length === 0) {
    console.warn('⚠️ No outputs found in cell execution');
  }
  
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    
    console.log(`📄 Raw output [${i}]:`, {
      outputType: output?.output_type,
      hasData: !!output?.data,
      hasText: !!output?.text,
      hasEname: !!output?.ename,
      hasTraceback: !!output?.traceback,
      keys: output ? Object.keys(output) : [],
      fullOutput: JSON.stringify(output, null, 2).substring(0, 500) // Full serialization for debugging
    });
    
    const parsed = parseGraderOutput(output);
    console.log(`✅ Parsed output [${i}]:`, {
      outputLength: parsed.output.length,
      success: parsed.success,
      preview: parsed.output.substring(0, 200)
    });
    
    if (parsed.output) {
      fullOutput += parsed.output;
      if (i < outputs.length - 1) {
        fullOutput += '\n';
      }
    }

    if (!parsed.success) {
      hasError = true;
    }
  }
  
  console.log('📋 Final combined output:', {
    length: fullOutput.length,
    preview: fullOutput.substring(0, 300)
  });

  // Determine overall success
  const overallSuccess = !hasError && fullOutput.length > 0;

  console.log('📤 Sending autograder event to backend:', {
    grader_id: graderId,
    output_length: fullOutput.trim().length,
    success: overallSuccess
  });

  // Log to Firestore (non-blocking)
  // Only logs: grader_id, output, success, timestamp
  logAutograderEvent({
    grader_id: graderId,
    output: fullOutput.trim(),
    success: overallSuccess
  }).catch(error => {
    // Additional error handling (though logAutograderEvent already handles errors)
    console.error('❌ Failed to log autograder event:', error);
  });
}