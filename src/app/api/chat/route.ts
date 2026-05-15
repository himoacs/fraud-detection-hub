import { NextRequest } from 'next/server';

/**
 * Chat API route - Fraud Detection Hub Assistant
 * 
 * Integration with SAM HTTP SSE Gateway:
 * 1. Submit message via POST /api/v1/message:stream (returns task ID)
 * 2. Subscribe to SSE stream at GET /api/v1/sse/subscribe/{task_id}
 * 3. Read the stream until we get the final_response event
 */

// SAM HTTP SSE Gateway URL
const SAM_URL = process.env.SAM_URL || 'http://localhost:9000';

// Session storage for conversation continuity (maps dashboard session to SAM session)
const contexts = new Map<string, string>();

// Timeout configuration
const SSE_TIMEOUT = 90000; // 90 seconds max wait for SSE response (database queries can be slow)

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Extract response text from SSE event data
 */
function extractResponseFromSSEData(dataStr: string): string | null {
  try {
    const data = JSON.parse(dataStr);
    // The response can be nested in different formats
    const parts = data?.result?.status?.message?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.kind === 'text' && part.text) {
          return part.text;
        }
      }
    }
    return null;
  } catch (e) {
    console.error('[Chat API] Error parsing SSE data:', e);
    return null;
  }
}

/**
 * Extract thinking/status text from status_update event
 * Returns detailed progress information about what the agents are doing
 * SAM sends these event types:
 * - agent_progress_update: has status_text
 * - tool_invocation_start: has tool_name, tool_args
 * - tool_result: has tool_name, result_data
 * - llm_invocation: LLM is thinking
 * - llm_response: LLM finished
 */
function extractThinkingFromStatusUpdate(dataStr: string): { text: string; agentName?: string } | null {
  try {
    const data = JSON.parse(dataStr);
    const agentName = data?.result?.metadata?.agent_name;
    const parts = data?.result?.status?.message?.parts;
    
    if (Array.isArray(parts)) {
      for (const part of parts) {
        // Check for agent_progress_update - this has the status_text we want
        if (part.data?.type === 'agent_progress_update') {
          const statusText = part.data?.status_text;
          if (statusText) {
            return { text: statusText, agentName };
          }
        }
        
        // Check for tool_invocation_start - shows which tool is being called
        if (part.data?.type === 'tool_invocation_start') {
          const toolName = part.data?.tool_name || '';
          // Make tool names more user-friendly
          if (toolName.includes('sql') || toolName.includes('query') || toolName.includes('database')) {
            return { text: `Querying database...`, agentName: 'SQL Connector' };
          }
          if (toolName.includes('fraud')) {
            return { text: `Analyzing fraud patterns...`, agentName };
          }
          if (toolName.includes('peer_agent') || toolName.includes('invoke_agent')) {
            const args = part.data?.tool_args;
            const targetAgent = args?.agent_name || args?.target || 'specialist agent';
            return { text: `Delegating to ${targetAgent}...`, agentName };
          }
          if (toolName) {
            return { text: `Running ${toolName.replace(/_/g, ' ')}...`, agentName };
          }
        }
        
        // Check for tool_result - tool finished
        if (part.data?.type === 'tool_result') {
          const toolName = part.data?.tool_name || '';
          if (toolName.includes('sql') || toolName.includes('query')) {
            return { text: `Processing query results...`, agentName: 'SQL Connector' };
          }
          return { text: `Processing results...`, agentName };
        }
        
        // Check for llm_invocation - agent is thinking
        if (part.data?.type === 'llm_invocation') {
          return { text: 'Thinking...', agentName };
        }
        
        // Check for llm_response - agent finished thinking
        if (part.data?.type === 'llm_response') {
          return { text: 'Generating response...', agentName };
        }
        
        // Check for text content - skip if it's the actual response (contains markdown)
        if (part.kind === 'text' && part.text) {
          // Skip if it looks like response content (markdown/code/tables)
          if (part.text.includes('|') || part.text.includes('#') || 
              part.text.includes('**') || part.text.includes('`') ||
              part.text.length > 100) {
            return null;  // Don't show response text as thinking
          }
          return { text: part.text.trim(), agentName };
        }
      }
    }
    
    // Check for agent-level status
    const status = data?.result?.status;
    if (status?.state === 'working' && !parts?.length) {
      return { text: 'Working...', agentName };
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Subscribe to SSE stream and forward events to client controller
 * This streams thinking steps as they arrive, then sends the final response
 */
async function streamSSEToClient(
  taskId: string, 
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<boolean> {
  console.log('[Chat API] Subscribing to SSE for task:', taskId);
  
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log('[Chat API] SSE timeout triggered after', SSE_TIMEOUT, 'ms');
    abortController.abort();
  }, SSE_TIMEOUT);
  
  let gotFinalResponse = false;
  let lastThinkingKey = '';  // Dedupe repeated thinking messages (combines agent + text)
  let lastAgentName = '';    // Track agent transitions
  
  try {
    const sseResponse = await fetch(`${SAM_URL}/api/v1/sse/subscribe/${taskId}`, {
      headers: { 'Accept': 'text/event-stream' },
      signal: abortController.signal,
    });
    
    if (!sseResponse.ok || !sseResponse.body) {
      console.error('[Chat API] SSE connection failed:', sseResponse.status);
      return false;
    }
    
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventCount = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // Process complete SSE events - handle both CRLF and LF
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      
      for (const eventBlock of events) {
        if (!eventBlock.trim()) continue;
        eventCount++;
        
        let eventType = '';
        let eventData = '';
        
        for (const line of eventBlock.split(/\r?\n/)) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            eventData = line.slice(5).trim();
          }
        }
        
        // Stream status_update events as "thinking" to the client
        if (eventType === 'status_update' && eventData) {
          const thinking = extractThinkingFromStatusUpdate(eventData);
          if (thinking && thinking.text) {
            // Create a unique key combining agent and text to allow agent transitions
            const thinkingKey = `${thinking.agentName || ''}:${thinking.text}`;
            
            // Also show update if agent changed (even if text is same)
            const agentChanged = thinking.agentName && thinking.agentName !== lastAgentName;
            
            if (thinkingKey !== lastThinkingKey || agentChanged) {
              lastThinkingKey = thinkingKey;
              lastAgentName = thinking.agentName || lastAgentName;
              
              const thinkingEvent = {
                type: 'thinking',
                content: thinking.text,
                agent: thinking.agentName
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(thinkingEvent)}\n\n`));
            }
          }
        }
        
        // Handle final_response
        if (eventType === 'final_response' && eventData) {
          const response = extractResponseFromSSEData(eventData);
          if (response) {
            console.log('[Chat API] Got final response');
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: response })}\n\n`));
            gotFinalResponse = true;
            reader.cancel();
            return true;
          }
        }
      }
    }
    
    return gotFinalResponse;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log('[Chat API] SSE aborted (timeout)');
    } else {
      console.error('[Chat API] SSE error:', error);
    }
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId = 'default' } = body;

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get or create context ID for this session
    // Use web-session-{uuid} format to match SAM UI sessions
    let contextId = contexts.get(sessionId);
    if (!contextId) {
      contextId = `web-session-${generateUUID().replace(/-/g, '')}`;
      contexts.set(sessionId, contextId);
    }

    // Create SSE response stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Build JSON-RPC request for SAM A2A API
          const requestId = `req-${Date.now()}`;
          const messageId = `msg-${Date.now()}`;
          
          // Route database queries directly to Fraud Analytics Agent (has SQL connector)
          // Agent name from SAM: agent_019e2800_ac7f_78e0_93da_5c1ab2140fa4
          const isDataQuery = /\b(list|show|query|how many|count|get|display|fetch|select|find|what|which|total|sum|average|max|min|blocked|approved|alerts?|transactions?|statistics|metrics|data|database|history|details|recent|today|yesterday|last|all)\b/i.test(message);
          const FRAUD_ANALYTICS_AGENT = "agent_019e2800_ac7f_78e0_93da_5c1ab2140fa4";
          const TARGET_AGENT = isDataQuery ? FRAUD_ANALYTICS_AGENT : "OrchestratorAgent";
          
          console.log(`[Chat API] Routing to: ${TARGET_AGENT} (isDataQuery: ${isDataQuery})`);
          
          const jsonRpcRequest = {
            id: requestId,
            jsonrpc: "2.0",
            method: "message/stream",  // Use stream method
            params: {
              message: {
                contextId: contextId,
                kind: "message",
                messageId: messageId,
                metadata: { agent_name: TARGET_AGENT },
                parts: [{ kind: "text", text: message }],
                role: "user",
              },
            },
          };

          console.log('[Chat API] Submitting message to SAM, context:', contextId);
          
          // Step 1: Submit message via message:stream endpoint
          const submitResponse = await fetch(`${SAM_URL}/api/v1/message:stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonRpcRequest),
            signal: AbortSignal.timeout(10000),
          });

          if (!submitResponse.ok) {
            const errText = await submitResponse.text();
            console.error('[Chat API] SAM error response:', errText);
            throw new Error(`SAM error: ${submitResponse.status}`);
          }

          const submitResult = await submitResponse.json();
          const taskId = submitResult.result?.id;
          
          if (!taskId) {
            throw new Error('No task ID from SAM');
          }
          
          console.log('[Chat API] Task ID:', taskId);
          
          // Send initial "connecting" status
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'thinking', content: 'Connecting to SAM...', agent: 'System' })}\n\n`));
          
          // Step 2: Subscribe to SSE stream and forward events to client
          const success = await streamSSEToClient(taskId, controller, encoder);
          
          if (!success) {
            console.log('[Chat API] No SAM response, using fallback');
            const fallback = generateFallbackResponse(message);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: fallback })}\n\n`));
          }

        } catch (error) {
          console.error('[Chat API] Error:', error);
          const fallback = generateFallbackResponse(message);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: fallback })}\n\n`));
        } finally {
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Chat API] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Generate a fallback response when SAM Gateway is unavailable or times out
 */
function generateFallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  // Math/calculation questions
  if (lowerMessage.includes('2+2') || lowerMessage.includes('2 + 2')) {
    return "2 + 2 = 4! For complex calculations and queries, use the **SAM Chat UI** at [localhost:8000](http://localhost:8000).";
  }
  
  // Fraud-related queries
  if (lowerMessage.includes('fraud rate') || lowerMessage.includes('fraud percentage') || 
      lowerMessage.includes('fraud count') || lowerMessage.includes('how many fraud')) {
    return "📊 **Fraud Rate Analysis**\n\nTo query exact fraud statistics from the database, please use the **SAM Chat UI** at [localhost:8000](http://localhost:8000) where the SQL Connector is configured.\n\nThe dashboard metrics panel shows real-time fraud statistics.";
  }
  
  if (lowerMessage.includes('transaction') && (lowerMessage.includes('blocked') || lowerMessage.includes('recent') || lowerMessage.includes('high risk'))) {
    return "📋 **Transaction Query**\n\nTo query specific transactions from the database, use the **SAM Chat UI** at [localhost:8000](http://localhost:8000).\n\nThe Transaction Feed on this dashboard shows recent transactions in real-time.";
  }
  
  if (lowerMessage.includes('alert') || lowerMessage.includes('warning') || lowerMessage.includes('pattern')) {
    return "🚨 **Alert Analysis**\n\nFor detailed alert queries and pattern analysis, use the **SAM Chat UI** at [localhost:8000](http://localhost:8000).\n\nThe Alerts panel shows recent fraud alerts.";
  }
  
  // Greetings
  if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
    return "Hello! 👋 I'm your fraud detection assistant.\n\n**What I can help with:**\n- Real-time fraud monitoring (see dashboard)\n- Alert notifications\n- Transaction analysis\n\n**For database queries:**\nUse the **SAM Chat UI** at [localhost:8000](http://localhost:8000) where the Fraud Analytics Agent and SQL Connector are configured.";
  }
  
  // Help/capabilities
  if (lowerMessage.includes('help') || lowerMessage.includes('what can you') || lowerMessage.includes('capabilities')) {
    return "**Fraud Detection Hub**\n\n📊 **Dashboard Features:**\n- Real-time transaction monitoring\n- Fraud rate metrics\n- Alert notifications\n- Risk score distribution\n\n💬 **For SQL Queries:**\nUse the **SAM Chat UI** at [localhost:8000](http://localhost:8000) where you can:\n- Query the fraud_detection database\n- Analyze historical patterns\n- Get detailed analytics\n\nTry: *\"What's the fraud rate for today?\"* in SAM UI";
  }
  
  // Default response
  return "I can help with fraud detection insights. For **database queries** and **advanced analytics**, please use the **SAM Chat UI** at [localhost:8000](http://localhost:8000).\n\nThe dashboard shows real-time fraud monitoring data.";
}

// Handle GET requests for health check
export async function GET() {
  return new Response(JSON.stringify({ 
    status: 'ok',
    samUrl: SAM_URL,
    sessions: contexts.size,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
