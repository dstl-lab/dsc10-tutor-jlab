import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { MainAreaWidget } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { createAppWidget } from './AppWidget';
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

    // Attach app to the right-hand sidebar!
    // TODO: the sidebar is closed by default, it should be opened
    // TODO: we should set a min-width so the sidebar can't be dragged to 0 width
    const widget = new MainAreaWidget({
      content: createAppWidget({ notebookTracker })
    });
    widget.id = 'chatbot-widget';
    widget.title.label = 'AI Tutor';
    widget.title.closable = true;

    app.shell.add(widget, 'right');
    app.shell.activateById(widget.id);

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
