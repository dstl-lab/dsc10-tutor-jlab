import * as React from 'react';

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

export default function ChatMessages() {
  return (
    <div className="chat-messages">
      {messages.map((message, index) => {
        const isUser = message.author === 'user';
        return (
          <div
            key={index}
            className={`chat-message ${isUser ? 'chat-message-user' : 'chat-message-tutor'}`}
          >
            <div className="chat-message-content">{message.text}</div>
          </div>
        );
      })}
    </div>
  );
}
