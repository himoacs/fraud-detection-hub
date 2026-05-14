'use client';

import { useState, useRef, useEffect } from 'react';

// Pre-configured filters demonstrating Solace wildcard patterns
export const TOPIC_PRESETS = [
  { label: 'All', topic: 'solace/fraud/v1/transactions/inbound/>', description: 'Multi-level wildcard >' },
  { label: 'US', topic: 'solace/fraud/v1/transactions/inbound/US/>', description: 'US transactions only' },
  { label: 'CA', topic: 'solace/fraud/v1/transactions/inbound/CA/>', description: 'Canada transactions' },
  { label: 'UK', topic: 'solace/fraud/v1/transactions/inbound/UK/>', description: 'UK transactions' },
  { label: 'DE', topic: 'solace/fraud/v1/transactions/inbound/DE/>', description: 'Germany transactions' },
  { label: 'Card Present', topic: 'solace/fraud/v1/transactions/inbound/*/card_present', description: 'Single-level wildcard *' },
  { label: 'Card Not Present', topic: 'solace/fraud/v1/transactions/inbound/*/card_not_present', description: 'Online/CNP transactions' },
  { label: 'Wire', topic: 'solace/fraud/v1/transactions/inbound/*/wire', description: 'Wire transfers' },
  { label: 'ACH', topic: 'solace/fraud/v1/transactions/inbound/*/ach', description: 'ACH payments' },
] as const;

interface TopicFilterProps {
  currentTopic: string;
  onTopicChange: (topic: string) => void;
  transactionCount: number;
  className?: string;
}

export function TopicFilter({ 
  currentTopic, 
  onTopicChange, 
  transactionCount,
  className = '' 
}: TopicFilterProps) {
  const [customTopic, setCustomTopic] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find if current topic matches a preset
  const activePreset = TOPIC_PRESETS.find(p => p.topic === currentTopic);
  const isCustomActive = !activePreset && currentTopic !== 'fraud/transactions/raw/>';

  // Focus input when showing custom input
  useEffect(() => {
    if (showCustomInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCustomInput]);

  // Validate topic pattern
  const validateTopic = (topic: string): boolean => {
    if (!topic.trim()) return false;
    // Must start with fraud/transactions
    if (!topic.startsWith('fraud/transactions/')) return false;
    // Check for valid characters
    const validPattern = /^[a-zA-Z0-9/*/>_-]+$/;
    return validPattern.test(topic);
  };

  const handleCustomSubmit = () => {
    if (validateTopic(customTopic)) {
      onTopicChange(customTopic);
      setShowCustomInput(false);
      setIsValid(true);
    } else {
      setIsValid(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomSubmit();
    } else if (e.key === 'Escape') {
      setShowCustomInput(false);
      setCustomTopic('');
      setIsValid(true);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Active subscription display */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--foreground-secondary)]">Subscribed to:</span>
        <code className="px-2 py-1 bg-[var(--solace-green)]/10 text-[var(--solace-green)] rounded text-xs font-mono border border-[var(--solace-green)]/20">
          {currentTopic}
        </code>
        <span className="text-xs text-[var(--foreground-secondary)]">
          ({transactionCount} received)
        </span>
      </div>

      {/* Preset filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {TOPIC_PRESETS.map((preset) => {
          const isActive = preset.topic === currentTopic;
          return (
            <button
              key={preset.topic}
              onClick={() => onTopicChange(preset.topic)}
              title={`${preset.description}\n${preset.topic}`}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                isActive
                  ? 'bg-[var(--solace-green)] text-black border-[var(--solace-green)]'
                  : 'bg-[var(--background-elevated)] text-[var(--foreground-secondary)] border-[var(--border)] hover:border-[var(--solace-green)]/50 hover:text-white'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        
        {/* Custom topic button */}
        <button
          onClick={() => setShowCustomInput(true)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all border flex items-center gap-1 ${
            isCustomActive
              ? 'bg-[var(--solace-green)] text-black border-[var(--solace-green)]'
              : 'bg-[var(--background-elevated)] text-[var(--foreground-secondary)] border-[var(--border)] hover:border-[var(--solace-green)]/50 hover:text-white'
          }`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Custom
        </button>
      </div>

      {/* Custom topic input */}
      {showCustomInput && (
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <input
              ref={inputRef}
              type="text"
              value={customTopic}
              onChange={(e) => {
                setCustomTopic(e.target.value);
                setIsValid(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder="fraud/transactions/raw/US/card_present"
              className={`w-full px-3 py-2 bg-[var(--background-elevated)] border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 ${
                isValid
                  ? 'border-[var(--border)] focus:ring-[var(--solace-green)]/30 focus:border-[var(--solace-green)]'
                  : 'border-[var(--danger)] focus:ring-[var(--danger)]/30'
              }`}
            />
            {!isValid && (
              <p className="text-xs text-[var(--danger)] mt-1">
                Invalid topic. Must start with fraud/transactions/
              </p>
            )}
          </div>
          <button
            onClick={handleCustomSubmit}
            className="px-3 py-2 bg-[var(--solace-green)] text-black rounded-lg text-sm font-medium hover:bg-[var(--solace-green-hover)] transition-colors"
          >
            Subscribe
          </button>
          <button
            onClick={() => {
              setShowCustomInput(false);
              setCustomTopic('');
              setIsValid(true);
            }}
            className="px-3 py-2 bg-[var(--background-elevated)] text-[var(--foreground-secondary)] rounded-lg text-sm hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Wildcard legend */}
      <div className="flex items-center gap-4 text-[10px] text-[var(--foreground-muted)]">
        <span className="flex items-center gap-1">
          <code className="px-1 bg-[var(--background-elevated)] rounded">*</code>
          single level
        </span>
        <span className="flex items-center gap-1">
          <code className="px-1 bg-[var(--background-elevated)] rounded">&gt;</code>
          multi-level
        </span>
        <span className="text-[var(--foreground-secondary)]">
          Solace broker filters messages server-side
        </span>
      </div>
    </div>
  );
}
