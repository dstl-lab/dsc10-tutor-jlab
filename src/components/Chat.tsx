import * as React from 'react';
import ChatMessageBox from './ChatMessageBox';

const messages = [
  {
    author: 'user',
    text: 'how do i read in a CSV file?'
  },
  {
    author: 'tutor',
    text: 'try pd.read_csv()!'
  }
];

export default function Chat() {
  return (
    <div>
      <div>
        {messages.map((message, index) => (
          <div key={index}>
            <p>{message.text}</p>
            <small>{message.author}</small>
          </div>
        ))}
      </div>
      <ChatMessageBox />
    </div>
  );
}
