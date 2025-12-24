import React from 'react';

export type FrontendPromptMode = 'tutor' | 'chatgpt' | 'none';

interface IToggleModeProps {
  mode: FrontendPromptMode;
  setMode: (m: FrontendPromptMode) => void;
  disabled?: boolean;
}

export default function ToggleMode({
  mode,
  setMode,
  disabled
}: IToggleModeProps) {
  return (
    <div className="flex w-full justify-center">
      <div className="inline-flex items-center gap-0.5 rounded-full bg-blue-500 p-0.5">
        <button
          onClick={() => setMode('tutor')}
          disabled={disabled}
          aria-pressed={mode === 'tutor'}
          style={{ borderRadius: '9999px' }}
          className={
            'flex h-6 items-center justify-center px-4 text-xs font-medium whitespace-nowrap transition-all focus:outline-none ' +
            (mode === 'tutor'
              ? 'bg-white text-blue-600'
              : 'bg-transparent text-white')
          }
        >
          Tutor
        </button>

        <button
          onClick={() => setMode('chatgpt')}
          disabled={disabled}
          aria-pressed={mode === 'chatgpt'}
          style={{ borderRadius: '9999px' }}
          className={
            'flex h-6 items-center justify-center px-4 text-xs font-medium whitespace-nowrap transition-all focus:outline-none ' +
            (mode === 'chatgpt'
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
