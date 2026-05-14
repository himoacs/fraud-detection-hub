/**
 * Server-side Solace Publisher for Simulator
 * 
 * This module publishes raw transactions to Solace broker
 * for SAM agents to process.
 */

// Use dynamic require for Node.js environment to avoid ES module issues
const solace = require('solclientjs');

// Initialize Solace factory (server-side)
let factoryInitialized = false;

function initFactory() {
  if (factoryInitialized) return;
  
  const factoryProps = new solace.SolclientFactoryProperties();
  factoryProps.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(factoryProps);
  factoryInitialized = true;
}

interface PublisherConfig {
  url: string;
  vpnName: string;
  userName: string;
  password: string;
}

class SolacePublisher {
  private session: any = null;
  private connected = false;
  private connecting = false;
  private messageQueue: Array<{ topic: string; payload: object }> = [];

  constructor(private config: PublisherConfig) {
    initFactory();
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.session = solace.SolclientFactory.createSession({
          url: this.config.url,
          vpnName: this.config.vpnName,
          userName: this.config.userName,
          password: this.config.password,
          connectTimeoutInMsecs: 10000,
          reconnectRetries: 5,
          reconnectRetryWaitInMsecs: 2000,
        });

        // Use only events that the session actually emits: 0,1,2,4,5,6,7,8,9,10,11,13,14,22,23,24,25,26,27,28,29,30,31
        // SessionEventCode: UP_NOTICE=0, DOWN_ERROR=1, CONNECT_FAILED_ERROR=2
        
        this.session.on(0, () => { // UP_NOTICE
          this.connected = true;
          this.connecting = false;
          console.log('[SolacePublisher] Connected to broker at', this.config.url);
          this.flushQueue();
          resolve();
        });

        this.session.on(2, (event: any) => { // CONNECT_FAILED_ERROR
          this.connecting = false;
          console.error('[SolacePublisher] Connection failed:', event?.infoStr);
          reject(new Error(`Connection failed: ${event?.infoStr}`));
        });

        this.session.on(1, () => { // DOWN_ERROR
          this.connected = false;
          this.connecting = false;
          console.log('[SolacePublisher] Connection down');
        });

        console.log('[SolacePublisher] Connecting to', this.config.url, 'vpn:', this.config.vpnName, 'user:', this.config.userName);
        this.session.connect();
      } catch (error) {
        this.connecting = false;
        reject(error);
      }
    });
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.connected) {
      const msg = this.messageQueue.shift();
      if (msg) {
        this.publishInternal(msg.topic, msg.payload);
      }
    }
  }

  private publishInternal(topic: string, payload: object): void {
    if (!this.session) return;

    const message = solace.SolclientFactory.createMessage();
    message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
    
    // Use SDT container with text for proper encoding that EMG can decode
    const payloadStr = JSON.stringify(payload);
    const sdtContainer = solace.SDTField.create(solace.SDTFieldType.STRING, payloadStr);
    message.setSdtContainer(sdtContainer);
    message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);

    this.session.send(message);
  }

  publish(topic: string, payload: object): void {
    if (!this.connected) {
      // Queue message if not connected
      this.messageQueue.push({ topic, payload });
      
      // Try to connect if not already connecting
      if (!this.connecting) {
        this.connect().catch(err => {
          console.error('[SolacePublisher] Failed to connect:', err);
        });
      }
      return;
    }

    this.publishInternal(topic, payload);
  }

  disconnect(): void {
    if (this.session && this.connected) {
      this.session.disconnect();
      this.session = null;
      this.connected = false;
      this.connecting = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Singleton publisher instance
let publisher: SolacePublisher | null = null;

export function getPublisher(): SolacePublisher {
  if (!publisher) {
    publisher = new SolacePublisher({
      url: process.env.SOLACE_URL || 'ws://localhost:8008',
      vpnName: process.env.SOLACE_VPN || 'sam',
      userName: process.env.SOLACE_USERNAME || 'sam',
      password: process.env.SOLACE_PASSWORD || 'sam',
    });
  }
  return publisher;
}

export async function publishTransaction(transaction: object): Promise<void> {
  const pub = getPublisher();
  
  // Ensure connected
  if (!pub.isConnected()) {
    await pub.connect();
  }

  // Determine topic based on transaction data
  const tx = transaction as { merchant?: { country?: string }; type?: string; amount?: number; isFraud?: boolean };
  const country = tx.merchant?.country || 'XX';
  const txType = tx.type || 'unknown';
  
  // Publish to inbound topic (for SAM gateway to consume)
  const rawTopic = `solace/fraud/v1/transactions/inbound/${country}/${txType}`;
  pub.publish(rawTopic, transaction);
  
  // TEMP: Also publish to scored topic with mock score so dashboard can display
  // TODO: Remove this once SAM agents are deployed
  const riskScore = tx.isFraud ? 0.75 + Math.random() * 0.25 : Math.random() * 0.4;
  const scoredTransaction = {
    ...transaction,
    riskScore,
    riskLevel: riskScore > 0.7 ? 'HIGH' : riskScore > 0.5 ? 'MEDIUM' : 'LOW',
    scoredAt: new Date().toISOString(),
    scoredBy: 'mock-scorer' // Will be 'sam-transaction-scorer' once deployed
  };
  const scoredTopic = `fraud/transactions/scored/${country}/${txType}`;
  pub.publish(scoredTopic, scoredTransaction);
}

export { SolacePublisher };
