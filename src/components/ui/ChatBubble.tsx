'use client';

import { useState } from 'react';
import { ChatWindow } from './ChatWindow';

export function ChatBubble() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Chat Window */}
      {isOpen && (
        <ChatWindow onClose={() => setIsOpen(false)} />
      )}

      {/* Floating Chat Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full 
            bg-[var(--solace-green)] hover:bg-[var(--solace-green-light)]
            shadow-lg shadow-[var(--solace-green)]/25
            flex items-center justify-center
            transition-all duration-200 hover:scale-105
            group"
          aria-label="Open chat"
        >
          {/* Chat icon */}
          <svg 
            className="w-6 h-6 text-black" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" 
            />
          </svg>
          
          {/* Tooltip */}
          <span className="absolute right-full mr-3 px-2 py-1 text-sm 
            bg-[var(--background-elevated)] text-white rounded
            opacity-0 group-hover:opacity-100 transition-opacity
            whitespace-nowrap pointer-events-none">
            Ask SAM about fraud insights
          </span>
        </button>
      )}
    </>
  );
}
