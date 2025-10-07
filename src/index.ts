import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { requestAPI } from './handler';

/**
 * Initialization data for the dsc10-tutor-jlab-frontend extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'dsc10-tutor-jlab-frontend:plugin',
  description: 'AI Tutor for DSC 10',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: (app: JupyterFrontEnd, settingRegistry: ISettingRegistry | null) => {
    console.log('JupyterLab extension dsc10-tutor-jlab-frontend is activated!');

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('dsc10-tutor-jlab-frontend settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for dsc10-tutor-jlab-frontend.', reason);
        });
    }

    requestAPI<any>('get-example')
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The dsc10_tutor_jlab_backend server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
