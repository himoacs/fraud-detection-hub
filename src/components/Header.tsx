'use client';

import Image from 'next/image';

interface HeaderProps {
  connected: boolean;
}

export function Header({ connected }: HeaderProps) {
  return (
    <header className="bg-[var(--background-secondary)] border-b border-[var(--border)] px-6 py-4">
      <div className="flex items-center justify-between max-w-[1800px] mx-auto">
        {/* Logo + App Name */}
        <div className="flex items-center gap-4">
          {/* Official Solace Logo */}
          <Image
            src="/solace-logo.svg"
            alt="Solace"
            width={100}
            height={30}
            priority
          />
          <div className="h-6 w-px bg-[var(--border)]" />
          <h1 className="text-lg font-semibold text-white">
            Fraud Detection Hub
          </h1>
        </div>

        {/* AI Model Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs bg-[var(--background-elevated)] border border-[var(--border)]">
            <svg className="w-3.5 h-3.5 text-[var(--solace-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-[var(--foreground-secondary)]">AI:</span>
            <span className="text-white font-medium">gemini-flash-2</span>
          </div>
        </div>

        {/* Connection Status */}
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${connected ? 'bg-[var(--solace-green)]/10 text-[var(--solace-green)]' : 'bg-[var(--danger)]/10 text-[var(--danger)]'}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[var(--solace-green)] animate-pulse' : 'bg-[var(--danger)]'}`} />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>
    </header>
  );
}
