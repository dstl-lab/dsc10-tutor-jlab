import * as React from 'react';

const chatMessagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem'
};

const chatMessageBaseStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem'
};

const userMessageStyle: React.CSSProperties = {
  background: 'var(--jp-brand-color1)',
  color: 'white',
  borderRadius: '0.5rem',
  padding: '0.5rem 0.75rem',
  maxWidth: '90%',
  alignSelf: 'flex-end'
};

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
    <div style={chatMessagesStyle}>
      {messages.map((message, index) => {
        const isUser = message.author === 'user';
        return (
          <div
            key={index}
            style={{
              ...chatMessageBaseStyle,
              ...(isUser ? userMessageStyle : {})
            }}
          >
            <div>{message.text}</div>
          </div>
        );
      })}
    </div>
  );
}
