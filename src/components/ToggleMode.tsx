import React from 'react';

type Mode = 'append' | 'override';

interface IToggleModeProps {
  mode: Mode;
  setMode: (m: Mode) => void;
}

export default function ToggleMode({ mode, setMode }: IToggleModeProps) {
  return (
    <div className="flex w-full justify-center">
      <div className="inline-flex items-center gap-0.5 rounded-full bg-blue-500 p-0.5">
        <button
          onClick={() => setMode('append')}
          aria-pressed={mode === 'append'}
          style={{ borderRadius: '9999px' }}
          className={
            'flex h-6 items-center justify-center px-4 text-xs font-medium whitespace-nowrap transition-all focus:outline-none ' +
            (mode === 'append'
              ? 'bg-white text-blue-600'
              : 'bg-transparent text-white')
          }
        >
          Tutor
        </button>

        <button
          onClick={() => setMode('override')}
          aria-pressed={mode === 'override'}
          style={{ borderRadius: '9999px' }}
          className={
            'flex h-6 items-center justify-center px-4 text-xs font-medium whitespace-nowrap transition-all focus:outline-none ' +
            (mode === 'override'
              ? 'bg-white text-blue-600'
              : 'bg-transparent text-white')
          }
        >
          ChatGPT
        </button>
      </div>
    </div>
  );
}
