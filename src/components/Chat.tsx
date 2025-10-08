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

export default function Chat() {
  return (
    <div>
      {messages.map(message => (
        <div>
          <p>{message.text}</p>
          <small>{message.author}</small>
        </div>
      ))}
    </div>
  );
}
