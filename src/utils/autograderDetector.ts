import { ICellModel } from '@jupyterlab/cells';

import { logAutograderEvent } from './autograderLogger';

export function isAutograderExecution(cell: ICellModel): {
  isGrader: boolean;
  graderId?: string;
} {
  const source = cell.sharedModel?.source || '';
  const sourceStr = Array.isArray(source) ? source.join('') : source;

  const otterPattern = /otter\.check\(['"]([^'"]+)['"]\)/;
  const otterMatch = sourceStr.match(otterPattern);
  if (otterMatch) {
    return { isGrader: true, graderId: otterMatch[1] };
  }

  const graderPattern = /grader\.check\(['"]([^'"]+)['"]\)/;
  const graderMatch = sourceStr.match(graderPattern);
  if (graderMatch) {
    return { isGrader: true, graderId: graderMatch[1] };
  }

  const okPattern = /ok\.grade\(['"]([^'"]+)['"]\)/;
  const okMatch = sourceStr.match(okPattern);
  if (okMatch) {
    return { isGrader: true, graderId: okMatch[1] };
  }

  return { isGrader: false };
}

export function parseGraderOutput(output: any): {
  output: string;
  success: boolean;
} {
  let outputText = '';
  let success = false;

  if (!output) {
    return { output: '', success: false };
  }

  const arrayToString = (val: any): string => {
    if (Array.isArray(val)) {
      return val.join('');
    }
    return String(val || '');
  };

  if (typeof output === 'object') {
    let actualOutput = output;
    if (output._raw) {
      actualOutput = output._raw;
    } else if (output._rawData) {
      actualOutput = output._rawData;
    }

    const outputType =
      output.type || actualOutput.output_type || actualOutput.type;

    if (outputType === 'error') {
      const errorName = actualOutput.ename || output.ename || '';
      const errorValue = actualOutput.evalue || output.evalue || '';
      const traceback = actualOutput.traceback || output.traceback || [];

      if (Array.isArray(traceback) && traceback.length > 0) {
        outputText = traceback
          .map((line: any) =>
            Array.isArray(line) ? line.join('') : String(line)
          )
          .join('\n');
      }

      if (!outputText) {
        outputText = `${errorName}: ${errorValue}`;
      }

      success = false;
    } else if (outputType === 'stream') {
      const streamName = actualOutput.name || output.name || '';
      outputText = arrayToString(
        actualOutput.text || output.text || output._text
      );

      if (streamName === 'stderr' && outputText) {
        outputText = `[stderr] ${outputText}`;
      }

      const outputLower = outputText.toLowerCase();
      success =
        !outputLower.includes('error') && !outputLower.includes('failed');
    } else if (actualOutput.data || output.data) {
      const data = actualOutput.data || output.data;
      outputText =
        arrayToString(data['text/plain']) ||
        arrayToString(data['text/html']) ||
        arrayToString(data['text/markdown']) ||
        arrayToString(data['text/latex']) ||
        '';

      const outputLower = outputText.toLowerCase();
      success =
        outputLower.includes('all tests passed') ||
        outputLower.includes('test passed') ||
        outputLower.includes('passed!') ||
        outputLower.includes('✓') ||
        (outputLower.includes('passed') &&
          !outputLower.includes('failed') &&
          !outputLower.includes('error'));
    } else if (
      output._text !== undefined ||
      output.text !== undefined ||
      actualOutput.text !== undefined
    ) {
      outputText = arrayToString(
        output._text || output.text || actualOutput.text
      );

      const outputLower = outputText.toLowerCase();
      success =
        outputLower.includes('all tests passed') ||
        outputLower.includes('test passed') ||
        outputLower.includes('passed!') ||
        (!outputLower.includes('failed') &&
          !outputLower.includes('error') &&
          outputLower.includes('passed'));
    } else {
      try {
        const rawJson = output.toJSON ? output.toJSON() : actualOutput;
        outputText = JSON.stringify(rawJson, null, 2);
      } catch (e) {
        outputText = String(output);
      }
      success = false;
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
    outputText = String(output);
    success = false;
  }

  return {
    output: outputText.trim(),
    success
  };
}

export async function handleAutograderExecution(
  cell: ICellModel,
  outputs: any[]
): Promise<void> {
  const detection = isAutograderExecution(cell);
  if (!detection.isGrader) {
    return;
  }

  const graderId = detection.graderId || 'unknown';

  let fullOutput = '';
  let hasError = false;

  if (outputs.length === 0) {
    console.warn('⚠️ No outputs found in cell execution');
  }

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];

    const parsed = parseGraderOutput(output);

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

  const overallSuccess = !hasError && fullOutput.length > 0;

  logAutograderEvent({
    grader_id: graderId,
    output: fullOutput.trim(),
    success: overallSuccess
  }).catch(error => {
    console.error('Failed to log autograder event:', error);
  });
}
