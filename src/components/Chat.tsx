import * as React from 'react';

import ChatMessages from './ChatMessages';
import NotebookInfo from './NotebookInfo';
import ChatMessageBox from './ChatMessageBox';

export default function Chat() {
  return (
    <div className="flex h-full w-full flex-col gap-2">
      <ChatMessages />
      <ChatMessageBox />
      <NotebookInfo />
    </div>
  );
}
