import { 
  start, 
  stop, 
  setPublishCallback,
  setRawPublishCallback,
  setFraudRate,
  getStats,
  setMode as setGeneratorMode,
  injectFraud,
} from '@/lib/simulator/generator';
import type { ScoredTransaction, Transaction, SimulatorState } from '@/types';

export { injectFraud };

// Mode: 'demo' = local scoring (default), 'sam' = full SAM integration
// SAM mode requires separate backend setup - see agents/ directory
const mode = (process.env.SIMULATOR_MODE || 'demo') as 'demo' | 'sam';

// Initialize generator mode
setGeneratorMode(mode);

// SSE clients for broadcasting (used in demo mode, and for stats in SAM mode)
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();

function broadcast(type: string, data: unknown): void {
  const message = `data: ${JSON.stringify({ type, data })}\n\n`;
  const encoded = encoder.encode(message);
  
  sseClients.forEach((controller) => {
    try {
      controller.enqueue(encoded);
    } catch {
      sseClients.delete(controller);
    }
  });
}

// Solace publisher for SAM mode (lazy-loaded)
let solacePublisher: any = null;
let solaceInitialized = false;

async function initializeSolacePublisher(): Promise<void> {
  if (solaceInitialized || mode !== 'sam') return;
  
  try {
    console.log('[Service] Initializing Solace publisher...');
    const { getPublisher } = await import('@/lib/solace/publisher');
    solacePublisher = getPublisher();
    console.log('[Service] Connecting to Solace...');
    await solacePublisher.connect();
    solaceInitialized = true;
    console.log('[Service] Solace publisher connected and ready');
  } catch (error) {
    console.error('[Service] Failed to initialize Solace publisher:', error);
    // Don't throw - allow fallback to queuing
  }
}

function publishToSolace(tx: Transaction): void {
  if (!solacePublisher) {
    console.warn('[Service] Solace publisher not initialized');
    return;
  }
  
  if (!solacePublisher.isConnected()) {
    // Try to connect if not connected
    if (!solaceInitialized) {
      initializeSolacePublisher().catch(err => {
        console.error('[Service] Failed to init publisher:', err);
      });
    }
    // Queue the message - publisher will send when connected
  }
  
  const country = tx.merchant?.country || 'XX';
  const txType = tx.type || 'unknown';
  
  // Publish to inbound topic (for SAM gateway to consume)
  // Gateway forwards to agents, which publish to solace/fraud/v1/transactions/scored
  const rawTopic = `solace/fraud/v1/transactions/inbound/${country}/${txType}`;
  console.log(`[Service] Publishing to ${rawTopic}:`, tx.transaction_id);
  solacePublisher.publish(rawTopic, tx);
}

// Set up publish callbacks based on mode
if (mode === 'sam') {
  // SAM mode: publish raw transactions to Solace
  setRawPublishCallback((tx: Transaction) => {
    publishToSolace(tx);
  });
  console.log('[Service] SAM mode enabled - transactions will be published to Solace');
  
  // Eagerly initialize Solace publisher
  initializeSolacePublisher().catch(err => {
    console.error('[Service] Eager init failed:', err);
  });
} else {
  // Demo mode: broadcast scored transactions via SSE
  setPublishCallback((tx: ScoredTransaction) => {
    broadcast('transaction', tx);
  });
  console.log('[Service] Demo mode enabled - local scoring with SSE broadcast');
}

export async function startSimulator(fraudRate?: number): Promise<SimulatorState> {
  // Initialize Solace publisher for SAM mode
  if (mode === 'sam' && !solaceInitialized) {
    await initializeSolacePublisher();
  }
  
  if (typeof fraudRate === 'number') {
    setFraudRate(fraudRate);
  }
  
  return start();
}

export async function stopSimulator(): Promise<SimulatorState> {
  return stop();
}

export function addSSEClient(controller: ReadableStreamDefaultController<Uint8Array>): void {
  sseClients.add(controller);
  
  // Send initial connection message
  const initMessage = `data: ${JSON.stringify({ 
    type: 'connected',
    mode 
  })}\n\n`;
  controller.enqueue(encoder.encode(initMessage));
}

export function removeSSEClient(controller: ReadableStreamDefaultController<Uint8Array>): void {
  sseClients.delete(controller);
}

export function getMode(): string {
  return mode;
}

// Periodic stats broadcast
setInterval(() => {
  if (sseClients.size > 0) {
    broadcast('stats', getStats());
  }
}, 1000);
