import { ICellModel } from '@jupyterlab/cells';

export function isAutograderExecution(cell: ICellModel): {
  isGrader: boolean;
  graderId?: string;
} {
  const source = cell.sharedModel?.source || '';
  const sourceStr = Array.isArray(source) ? source.join('') : source;

  const graderPattern = /grader\.check\(['"]([^'"]+)['"]\)/;
  const graderMatch = sourceStr.match(graderPattern);
  if (graderMatch) {
    return { isGrader: true, graderId: graderMatch[1] };
  }

  const graderCheckAllPattern = /grader\.check_all\s*\(/;
  if (graderCheckAllPattern.test(sourceStr)) {
    return { isGrader: true, graderId: 'check_all' };
  }

  return { isGrader: false };
}

function toStr(val: unknown): string {
  if (Array.isArray(val)) return val.join('');
  return String(val ?? '');
}

/** Extract a single string from Jupyter-style cell output (common shapes only). */
function outputToText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;

  const o = output as Record<string, unknown>;
  const raw = o._raw ?? o._rawData ?? output;
  const obj = raw as Record<string, unknown>;

  // Error: traceback or ename/evalue
  const tb = (obj.traceback ?? o.traceback) as unknown[] | undefined;
  if (Array.isArray(tb) && tb.length > 0) {
    return tb.map(line => toStr(line)).join('\n');
  }
  if (
    obj.ename != null ||
    obj.evalue != null ||
    o.ename != null ||
    o.evalue != null
  ) {
    const ename = obj.ename ?? o.ename ?? '';
    const evalue = obj.evalue ?? o.evalue ?? '';
    return `${ename}: ${evalue}`;
  }

  // Stream or display: text or data
  const text = toStr(obj.text ?? o.text ?? o._text ?? obj._text);
  if (text)
    return obj.name === 'stderr' || o.name === 'stderr'
      ? `[stderr] ${text}`
      : text;

  const data = (obj.data ?? o.data) as Record<string, unknown> | undefined;
  if (data) {
    return toStr(data['text/plain']) || toStr(data['text/html']) || '';
  }

  return String(output);
}

export function parseGraderOutput(output: unknown): {
  output: string;
  success: boolean;
} {
  const text = outputToText(output).trim();
  const lower = text.toLowerCase();
  return {
    output: text,
    success:
      lower.includes('passed') &&
      !lower.includes('failed') &&
      !lower.includes('error')
  };
}
