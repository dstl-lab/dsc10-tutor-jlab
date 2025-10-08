import * as React from 'react';

import ChatMessages from './ChatMessages';
import NotebookInfo from './NotebookInfo';
import ChatMessageBox from './ChatMessageBox';

const styles = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '1rem',
  width: '100%',
  height: '100%'
};

export default function Chat() {
  return (
    <div style={styles}>
      <ChatMessages />
      <NotebookInfo />
      <ChatMessageBox />
    </div>
  );
}
