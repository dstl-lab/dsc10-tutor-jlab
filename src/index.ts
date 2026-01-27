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

    const setupAutograderMonitoring = () => {
      const notebook = notebookTracker.currentWidget?.content;
      if (!notebook) {
        return;
      }

      const model = notebook.model;
      if (!model) {
        return;
      }

      const processedExecutions = new Map<ICodeCellModel, number>();

      const connectCellOutputs = (cellModel: any) => {
        if (!cellModel || cellModel.type !== 'code') {
          return;
        }

        const codeCellModel = cellModel as ICodeCellModel;

        codeCellModel.outputs.changed.connect((sender, args) => {
          if (codeCellModel.outputs.length === 0) {
            return;
          }

          const detection = isAutograderExecution(cellModel);
          if (!detection.isGrader) {
            return;
          }

          const lastProcessed = processedExecutions.get(codeCellModel) || -1;
          const currentExecCount = codeCellModel.executionCount;

          const shouldProcess =
            currentExecCount === null ||
            currentExecCount === undefined ||
            currentExecCount > lastProcessed;

          if (shouldProcess) {
            processedExecutions.set(codeCellModel, currentExecCount ?? 0);

            const outputs: any[] = [];
            for (let i = 0; i < codeCellModel.outputs.length; i++) {
              outputs.push(codeCellModel.outputs.get(i));
            }

            handleAutograderExecution(cellModel, outputs).catch(error => {
              console.error('Error handling autograder execution:', error);
            });
          } else {
            console.log('Skipping duplicate execution:', {
              lastProcessed,
              currentExecCount
            });
          }
        });
      };

      for (let i = 0; i < model.cells.length; i++) {
        const cell = model.cells.get(i);
        if (cell) {
          connectCellOutputs(cell);
        }
      }

      model.cells.changed.connect((sender, args) => {
        if (args.type === 'add' && args.newValues) {
          args.newValues.forEach(cell => {
            if (cell) {
              connectCellOutputs(cell);
            }
          });
        } else if (args.type === 'remove' && args.oldValues) {
          args.oldValues.forEach(cell => {
            if (cell && cell.type === 'code') {
              processedExecutions.delete(cell as ICodeCellModel);
            }
          });
        }
      });
    };

    notebookTracker.currentChanged.connect(() => {
      setupAutograderMonitoring();
    });

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
