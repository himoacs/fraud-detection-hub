'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSolaceChat, type ChatMessage } from '@/hooks/useSolaceChat';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatWindowProps {
  onClose: () => void;
}

const SUGGESTED_PROMPTS = [
  "How many transactions were blocked vs approved today?",
  "Show high-risk transactions with score above 70 and their fraud patterns",
  "Which countries have the most blocked transactions?",
  "List high severity alerts with their transaction details",
  "What's the average risk score by merchant category?",
];

// Minimum and maximum dimensions for resize
const MIN_WIDTH = 350;
const MAX_WIDTH = 800;

export function ChatWindow({ onClose }: ChatWindowProps) {
  const { messages, isLoading, isConnected, error, sendMessage, clearMessages } = useSolaceChat();
  const [input, setInput] = useState('');
  const [width, setWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle resize (width only via left border)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rect.right - e.clientX));
      
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      sendMessage(input);
      setInput('');
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    if (!isLoading) {
      sendMessage(prompt);
    }
  };

  return (
    <div 
      ref={containerRef}
      style={{ width }}
      className="fixed bottom-6 right-6 z-50 h-[600px]
        bg-[var(--background-secondary)] border border-[var(--border)]
        rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Left border resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute top-0 left-0 w-1.5 h-full cursor-ew-resize z-10
          hover:bg-[var(--solace-green)]/40 transition-colors rounded-l-2xl
          ${isResizing ? 'bg-[var(--solace-green)]/60' : ''}`}
        title="Drag to resize"
      />
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 
        border-b border-[var(--border)] bg-[var(--background-elevated)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[var(--solace-green)]/20 
            flex items-center justify-center">
            <svg className="w-4 h-4 text-[var(--solace-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="font-medium text-white text-sm">SAM Assistant</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearMessages}
            className="p-1.5 text-[var(--foreground-secondary)] hover:text-white 
              hover:bg-[var(--background)] rounded transition-colors"
            title="Clear chat"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--foreground-secondary)] hover:text-white 
              hover:bg-[var(--background)] rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-12 h-12 rounded-full bg-[var(--solace-green)]/10 
              flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-[var(--solace-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h4 className="font-medium text-white mb-2">Ask about fraud insights</h4>
            <p className="text-sm text-[var(--foreground-secondary)] mb-6">
              Query transactions, alerts, fraud patterns, and real-time metrics from the fraud detection system.
            </p>
            
            {/* Suggested prompts */}
            <div className="w-full space-y-2">
              {SUGGESTED_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestedPrompt(prompt)}
                  className="w-full text-left px-3 py-2 text-sm
                    bg-[var(--background)] hover:bg-[var(--background-elevated)]
                    border border-[var(--border)] hover:border-[var(--solace-green)]/50
                    rounded-lg transition-colors text-[var(--foreground-secondary)]
                    hover:text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-[var(--border)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about fraud patterns, transactions..."
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-[var(--background)] 
              border border-[var(--border)] rounded-xl
              text-white placeholder:text-[var(--foreground-muted)]
              focus:outline-none focus:border-[var(--solace-green)]/50
              disabled:opacity-50 text-sm"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2.5 bg-[var(--solace-green)] hover:bg-[var(--solace-green-light)]
              rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <svg className="w-5 h-5 text-black animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" 
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isThinking = message.role === 'thinking';
  
  // Thinking messages have special styling
  if (isThinking) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%]">
          <div className="px-4 py-2 rounded-xl text-sm 
            bg-[var(--solace-green)]/10 border border-[var(--solace-green)]/30
            text-[var(--solace-green)]">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" 
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="font-medium text-xs">{message.agentName || 'SAM'}</span>
            </div>
            <p className="mt-1 text-[var(--foreground-secondary)]">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm ${
            isUser
              ? 'bg-[var(--solace-green)] text-black rounded-br-md'
              : 'bg-[var(--background-elevated)] text-white rounded-bl-md'
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">
              {message.content}
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none
              prose-headings:text-white prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-2
              prose-h2:text-base prose-h3:text-sm
              prose-p:text-[var(--foreground-secondary)] prose-p:my-1.5 prose-p:leading-relaxed
              prose-strong:text-white prose-strong:font-semibold
              prose-table:text-xs prose-table:my-2
              prose-th:bg-[var(--background)] prose-th:px-2 prose-th:py-1.5 prose-th:text-left prose-th:font-medium prose-th:text-[var(--foreground-secondary)] prose-th:border-b prose-th:border-[var(--border)]
              prose-td:px-2 prose-td:py-1 prose-td:border-b prose-td:border-[var(--border)]/50 prose-td:text-[var(--foreground-secondary)]
              prose-ul:my-1 prose-li:my-0.5
              prose-a:text-[var(--solace-green)] prose-a:no-underline hover:prose-a:underline
              prose-hr:border-[var(--border)] prose-hr:my-3
              prose-blockquote:border-l-[var(--solace-green)] prose-blockquote:bg-[var(--background)]/50 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:my-2 prose-blockquote:not-italic
              prose-code:text-[var(--solace-green)] prose-code:bg-[var(--background)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
            ">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
          )}
        </div>
        <div className={`text-xs text-[var(--foreground-muted)] mt-1 flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {!isUser && (
            <span className="flex items-center gap-1 text-[var(--solace-green)]/70">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd"/>
              </svg>
              SAM
            </span>
          )}
          <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  );
}
