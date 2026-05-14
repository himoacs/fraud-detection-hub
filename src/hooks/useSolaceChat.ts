'use client';

import { useState, useCallback, useRef } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  agentName?: string;  // For thinking steps, shows which agent is working
}

interface UseSolaceChatOptions {
  sessionId?: string;
}

export function useSolaceChat(options: UseSolaceChatOptions = {}) {
  const { sessionId = `session-${Date.now()}` } = options;
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(true); // Always "connected" via API
  const [error, setError] = useState<string | null>(null);
  
  const sessionIdRef = useRef(sessionId);
  const currentAssistantIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    // Create placeholder for assistant response
    const assistantMessageId = `assistant-${Date.now()}`;
    currentAssistantIdRef.current = assistantMessageId;
    
    // No placeholder - we'll add thinking messages as they arrive
    let thinkingMessageId: string | null = null;

    try {
      // Use the local API route which proxies to SAM Gateway
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          message: content.trim(),
          sessionId: sessionIdRef.current,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat API error: ${response.status}`);
      }

      // Handle SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        
        // Parse SSE events
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              // Remove thinking message and add final response
              setMessages(prev => {
                const filtered = prev.filter(msg => msg.role !== 'thinking');
                // If we have a response, update or add it
                if (fullResponse) {
                  const existing = filtered.find(msg => msg.id === assistantMessageId);
                  if (existing) {
                    return filtered.map(msg =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: fullResponse, isStreaming: false }
                        : msg
                    );
                  } else {
                    return [
                      ...filtered,
                      {
                        id: assistantMessageId,
                        role: 'assistant' as const,
                        content: fullResponse,
                        timestamp: new Date(),
                        isStreaming: false,
                      },
                    ];
                  }
                }
                return filtered;
              });
              currentAssistantIdRef.current = null;
              setIsLoading(false);
            } else if (data) {
              try {
                const parsed = JSON.parse(data);
                
                // Handle thinking events
                if (parsed.type === 'thinking') {
                  const thinkingContent = parsed.content || '';
                  const agentName = parsed.agent || 'SAM';
                  
                  // Update or create thinking message
                  if (!thinkingMessageId) {
                    thinkingMessageId = `thinking-${Date.now()}`;
                  }
                  
                  setMessages(prev => {
                    const existingIdx = prev.findIndex(msg => msg.id === thinkingMessageId);
                    if (existingIdx >= 0) {
                      // Update existing thinking message
                      return prev.map(msg =>
                        msg.id === thinkingMessageId
                          ? { ...msg, content: thinkingContent, agentName }
                          : msg
                      );
                    } else {
                      // Add new thinking message
                      return [
                        ...prev,
                        {
                          id: thinkingMessageId!,
                          role: 'thinking' as const,
                          content: thinkingContent,
                          timestamp: new Date(),
                          agentName,
                          isStreaming: true,
                        },
                      ];
                    }
                  });
                }
                // Handle content events (final response)
                else if (parsed.type === 'content' || parsed.content) {
                  const contentChunk = parsed.content || parsed.text || '';
                  if (contentChunk) {
                    fullResponse = contentChunk; // For SAM, it's the full response not a chunk
                    // Update streaming message
                    setMessages(prev => {
                      const filtered = prev.filter(msg => msg.role !== 'thinking');
                      const existing = filtered.find(msg => msg.id === assistantMessageId);
                      if (existing) {
                        return filtered.map(msg =>
                          msg.id === assistantMessageId
                            ? { ...msg, content: fullResponse, isStreaming: true }
                            : msg
                        );
                      } else {
                        return [
                          ...filtered,
                          {
                            id: assistantMessageId,
                            role: 'assistant' as const,
                            content: fullResponse,
                            timestamp: new Date(),
                            isStreaming: true,
                          },
                        ];
                      }
                    });
                  }
                }
              } catch {
                // Non-JSON data, ignore
              }
            }
          }
        }
      }

      // If we exited the loop without [DONE], finalize anyway
      if (currentAssistantIdRef.current === assistantMessageId) {
        setMessages(prev => {
          // Remove thinking messages and update/add assistant message
          const filtered = prev.filter(msg => msg.role !== 'thinking');
          const existing = filtered.find(msg => msg.id === assistantMessageId);
          if (existing) {
            return filtered.map(msg =>
              msg.id === assistantMessageId
                ? { ...msg, content: fullResponse || 'Response completed.', isStreaming: false }
                : msg
            );
          } else if (fullResponse) {
            return [
              ...filtered,
              {
                id: assistantMessageId,
                role: 'assistant' as const,
                content: fullResponse,
                timestamp: new Date(),
                isStreaming: false,
              },
            ];
          }
          return filtered;
        });
        currentAssistantIdRef.current = null;
        setIsLoading(false);
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled, clean up
        setMessages(prev => prev.filter(msg => msg.role !== 'thinking'));
        setIsLoading(false);
        return;
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      console.error('[SolaceChat] Error:', errorMessage);
      setError(errorMessage);
      
      // Clean up thinking messages and add error message
      setMessages(prev => {
        const filtered = prev.filter(msg => msg.role !== 'thinking');
        return [
          ...filtered,
          {
            id: assistantMessageId,
            role: 'assistant' as const,
            content: `Sorry, I couldn't connect to SAM. ${errorMessage}`,
            timestamp: new Date(),
            isStreaming: false,
          },
        ];
      });
      currentAssistantIdRef.current = null;
      setIsLoading(false);
    }
  }, [isLoading]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    currentAssistantIdRef.current = null;
    setIsLoading(false);
  }, []);

  return {
    messages,
    isLoading,
    isConnected,
    error,
    sendMessage,
    clearMessages,
    cancelRequest,
  };
}
