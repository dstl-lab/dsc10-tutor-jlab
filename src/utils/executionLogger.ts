import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { logEvent, observationMetadata } from '../api/logger';
import { isAutograderExecution, parseGraderOutput } from './autograderDetector';
import { logAutograderEvent } from './autograderLogger';
import { resolveTaskContext } from './taskContext';

type INotebookKernel = NonNullable<
  NonNullable<NotebookPanel['sessionContext']['session']>['kernel']
>;

interface IExecution {
  panel: NotebookPanel;
  kernel: INotebookKernel;
  binding: Record<string, unknown> & { source: string };
  output: string;
  outputComplete: boolean;
  reply?: KernelMessage.IExecuteReplyMsg['content'];
  idle: boolean;
}

// Observe submitted notebook-cell requests independently of the tutor sidebar.
export function startExecutionLogging(tracker: INotebookTracker): () => void {
  const panels = new Map<NotebookPanel, () => void>();
  const pending = new Map<string, IExecution>();
  const emit = (event_type: string, payload: Record<string, unknown>) =>
    logEvent({
      event_type,
      payload: {
        ...observationMetadata,
        ...payload,
        timestamp: new Date().toISOString()
      }
    });

  const finish = (id: string, execution: IExecution, reason?: string) => {
    pending.delete(id);
    const status = reason ? 'incomplete' : execution.reply!.status;
    const outputComplete = !reason && execution.outputComplete;
    const result = {
      ...execution.binding,
      status,
      execution_count: execution.reply?.execution_count ?? null,
      output: execution.output,
      output_complete: outputComplete,
      ...(reason ? { incomplete_reason: reason } : {})
    };
    emit('notebook_execution_finished', result);
    const grader = isAutograderExecution(execution.binding.source);
    if (grader.isGrader) {
      void logAutograderEvent({
        ...result,
        grader_id: grader.graderId!,
        notebook: String(execution.binding.notebook_name),
        checked_source: execution.binding.source,
        grader_detection_method: 'source_regex',
        execution_status: status,
        // This is a text heuristic about this command, not a kernel-state assessment.
        verdict_method: 'text_heuristic',
        success:
          outputComplete && status === 'ok'
            ? parseGraderOutput(execution.output).success
            : null
      });
    }
  };

  const attach = (panel: NotebookPanel) => {
    if (panels.has(panel) || panel.isDisposed) {
      return;
    }
    let kernel: INotebookKernel | null = null;
    const interrupt = (reason: string) => {
      for (const [id, execution] of pending) {
        if (execution.panel === panel) {
          finish(id, execution, reason);
        }
      }
    };
    const onMessage: Parameters<INotebookKernel['anyMessage']['connect']>[0] = (
      sender,
      { direction, msg }
    ) => {
      if (direction === 'send') {
        if (
          msg.channel !== 'shell' ||
          msg.header.msg_type !== 'execute_request' ||
          msg.header.session !== sender.clientId
        ) {
          return;
        }
        const request = msg as KernelMessage.IExecuteRequestMsg;
        const cellId = request.metadata.cellId;
        const cells = panel.content.model?.cells;
        if (request.content.silent || typeof cellId !== 'string' || !cells) {
          return;
        }
        let cellIndex = -1;
        for (let i = 0; i < cells.length; i++) {
          const cell = cells.get(i);
          if (cell.type === 'code' && cell.sharedModel.getId() === cellId) {
            cellIndex = i;
            break;
          }
        }
        if (cellIndex < 0) {
          return;
        }
        const id = `${sender.id}:${request.header.msg_id}`;
        if (pending.has(id)) {
          return;
        }
        const binding = {
          execution_id: request.header.msg_id,
          kernel_id: sender.id,
          kernel_client_id: request.header.session,
          notebook_session_id: panel.sessionContext.session?.id ?? null,
          notebook_path: panel.context.path,
          notebook_name: panel.title.label,
          cell_id: cellId,
          cell_index: cellIndex,
          task_context: resolveTaskContext(cells, cellIndex),
          source: request.content.code,
          source_capture: 'execute_request'
        };
        pending.set(id, {
          panel,
          kernel: sender,
          binding,
          output: '',
          outputComplete: true,
          idle: false
        });
        emit('notebook_execution_requested', binding);
        return;
      }
      const id = `${sender.id}:${msg.parent_header.msg_id}`;
      const execution = pending.get(id);
      if (
        !execution ||
        execution.kernel !== sender ||
        execution.panel !== panel
      ) {
        return;
      }
      const type = msg.header.msg_type;
      if (msg.channel === 'shell' && type === 'execute_reply') {
        execution.reply = (msg as KernelMessage.IExecuteReplyMsg).content;
      } else if (msg.channel === 'iopub') {
        if (type === 'status') {
          execution.idle =
            (msg as KernelMessage.IStatusMsg).content.execution_state ===
            'idle';
        } else if (
          ['stream', 'display_data', 'execute_result', 'error'].includes(type)
        ) {
          const output =
            type === 'stream'
              ? (msg as KernelMessage.IStreamMsg).content.text
              : parseGraderOutput(msg.content).output;
          const text = output && type !== 'stream' ? `${output}\n` : output;
          if (!text && type !== 'stream') {
            execution.outputComplete = false;
          }
          // ponytail: bounded text transcript; use a dedicated artifact store for full rich output.
          const remaining = 20000 - execution.output.length;
          execution.output += text.slice(0, remaining);
          if (text.length > remaining) {
            execution.outputComplete = false;
          }
        } else if (type === 'clear_output' || type === 'update_display_data') {
          execution.outputComplete = false;
        }
      }
      if (execution.reply && execution.idle) {
        finish(id, execution);
      }
    };
    const onConnection = (
      _: INotebookKernel,
      status: Kernel.ConnectionStatus
    ) => {
      if (status !== 'connected') {
        interrupt('connection_lost');
      }
    };
    const onStatus = (_: INotebookKernel, status: KernelMessage.Status) => {
      if (['dead', 'restarting', 'autorestarting'].includes(status)) {
        interrupt('kernel_restarted_or_dead');
      }
    };
    const disconnect = () => {
      kernel?.anyMessage.disconnect(onMessage);
      kernel?.connectionStatusChanged.disconnect(onConnection);
      kernel?.statusChanged.disconnect(onStatus);
    };
    const onKernel = () => {
      const next = panel.sessionContext.session?.kernel ?? null;
      if (next === kernel) {
        return;
      }
      interrupt('kernel_changed');
      disconnect();
      kernel = next;
      kernel?.anyMessage.connect(onMessage);
      kernel?.connectionStatusChanged.connect(onConnection);
      kernel?.statusChanged.connect(onStatus);
    };
    const cleanup = () => {
      const survivor = [...panels.keys()].find(
        other =>
          other !== panel &&
          !other.isDisposed &&
          other.context === panel.context &&
          other.sessionContext.session?.kernel === kernel
      );
      if (survivor) {
        for (const execution of pending.values()) {
          if (execution.panel === panel) {
            execution.panel = survivor;
          }
        }
      }
      interrupt('notebook_closed_or_logger_stopped');
      disconnect();
      panel.sessionContext.kernelChanged.disconnect(onKernel);
      panel.disposed.disconnect(cleanup);
      panels.delete(panel);
    };
    panels.set(panel, cleanup);
    panel.disposed.connect(cleanup);
    panel.sessionContext.kernelChanged.connect(onKernel);
    onKernel();
    void panel.sessionContext.ready.then(() => {
      if (panels.has(panel)) {
        onKernel();
      }
    });
  };
  const onAdded = (_: INotebookTracker, panel: NotebookPanel) => attach(panel);
  tracker.widgetAdded.connect(onAdded);
  tracker.forEach(attach);
  return () => {
    tracker.widgetAdded.disconnect(onAdded);
    for (const cleanup of [...panels.values()]) {
      cleanup();
    }
  };
}
