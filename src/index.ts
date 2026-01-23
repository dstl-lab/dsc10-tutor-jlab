import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  LabShell
} from '@jupyterlab/application';

import { MainAreaWidget } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ICodeCellModel } from '@jupyterlab/cells';

import { createAppWidget } from './AppWidget';
import { initializeFirebase } from './utils/firebase';
import {
  handleAutograderExecution,
  isAutograderExecution
} from './utils/autograderDetector';
// import { requestAPI } from './handler';

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'dsc10-tutor-jlab-frontend:plugin',
  description: 'AI Tutor for DSC 10',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null
  ) => {
    initializeFirebase();
    console.log('JupyterLab extension dsc10-tutor-jlab-frontend is activated!');

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log(
            'dsc10-tutor-jlab-frontend settings loaded:',
            settings.composite
          );
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for dsc10-tutor-jlab-frontend.',
            reason
          );
        });
    }

    // Attach app to the right-hand sidebar!
    // TODO: we should set a min-width so the sidebar can't be dragged to 0 width
    const widget = new MainAreaWidget({
      content: createAppWidget({ notebookTracker })
    });
    widget.id = 'chatbot-widget';
    widget.title.label = 'AI Tutor';
    widget.title.closable = true;

    const labShell = app.shell as LabShell;
    labShell.add(widget, 'right');
    labShell.activateById(widget.id);
    labShell.expandRight();

    // Monitor notebook cell executions for autograder events
    const setupAutograderMonitoring = () => {
      const notebook = notebookTracker.currentWidget?.content;
      if (!notebook) {
        console.log('⚠️ No notebook widget found for monitoring');
        return;
      }

      const model = notebook.model;
      if (!model) {
        console.log('⚠️ No notebook model found for monitoring');
        return;
      }

      console.log('✅ Setting up autograder monitoring for notebook');

      // Track which cells we've already processed (by execution count) to avoid duplicate logging
      const processedExecutions = new Map<ICodeCellModel, number>();

      // Listen to each cell's outputs changing (this fires when execution completes)
      const connectCellOutputs = (cellModel: any) => {
        if (!cellModel || cellModel.type !== 'code') {
          return;
        }
        
        const codeCellModel = cellModel as ICodeCellModel;
        
        // Listen to outputs changing - this fires when cell execution completes
        codeCellModel.outputs.changed.connect((sender, args) => {
          // Only process if outputs exist
          if (codeCellModel.outputs.length === 0) {
            return;
          }

          // FIRST: Check if this is an autograder cell (before any other processing)
          const detection = isAutograderExecution(cellModel);
          if (!detection.isGrader) {
            // Not an autograder cell, skip it
            return;
          }

          console.log('🎯 Autograder cell detected:', {
            graderId: detection.graderId,
            cellSource: codeCellModel.sharedModel?.source?.substring(0, 50),
            outputsLength: codeCellModel.outputs.length,
            executionCount: codeCellModel.executionCount
          });

          // Check if this is a new execution (execution count changed) to avoid duplicate logging
          const lastProcessed = processedExecutions.get(codeCellModel) || -1;
          const currentExecCount = codeCellModel.executionCount;
          
          // Process if execution count is null (error case) or if it increased
          // Use -1 as initial value so null/0 will be > -1
          const shouldProcess =
            currentExecCount === null ||
            currentExecCount === undefined ||
            currentExecCount > lastProcessed;

          if (shouldProcess) {
            // Update processed count (use 0 if null to track that we processed it)
            processedExecutions.set(
              codeCellModel,
              currentExecCount ?? 0
            );

            // Get all outputs from the cell
            const outputs: any[] = [];
            for (let i = 0; i < codeCellModel.outputs.length; i++) {
              outputs.push(codeCellModel.outputs.get(i));
            }

            console.log('📤 Logging autograder event:', {
              graderId: detection.graderId,
              outputsCount: outputs.length
            });

            // Log the autograder event (non-blocking)
            // Only logs: grader_id, output, success, timestamp
            handleAutograderExecution(cellModel, outputs).catch(error => {
              console.error('Error handling autograder execution:', error);
            });
          } else {
            console.log('⏭️ Skipping duplicate execution:', {
              lastProcessed,
              currentExecCount
            });
          }
        });
      };

      // Connect to existing cells
      console.log(`📝 Connecting to ${model.cells.length} existing cells`);
      for (let i = 0; i < model.cells.length; i++) {
        const cell = model.cells.get(i);
        if (cell) {
          connectCellOutputs(cell);
        }
      }

      // Connect to new cells when they're added
      model.cells.changed.connect((sender, args) => {
        console.log('📝 Cells changed:', args.type);
        if (args.type === 'add' && args.newValues) {
          args.newValues.forEach(cell => {
            if (cell) {
              console.log('➕ Connecting to new cell');
              connectCellOutputs(cell);
            }
          });
        } else if (args.type === 'remove' && args.oldValues) {
          // Remove from processed map when cell is deleted
          args.oldValues.forEach(cell => {
            if (cell && cell.type === 'code') {
              processedExecutions.delete(cell as ICodeCellModel);
            }
          });
        }
      });
    };

    // Set up monitoring when a notebook is opened
    notebookTracker.currentChanged.connect(() => {
      console.log('📓 Notebook changed, setting up monitoring...');
      setupAutograderMonitoring();
    });

    // Also set up for the current notebook if one is already open
    console.log('🚀 Initial setup of autograder monitoring...');
    setupAutograderMonitoring();

    // requestAPI<any>('get-example')
    //   .then(data => {
    //     console.log(data);
    //   })
    //   .catch(reason => {
    //     console.error(
    //       `The dsc10_tutor_jlab_backend server extension appears to be missing.\n${reason}`
    //     );
    //   });
  }
};

export default plugin;
