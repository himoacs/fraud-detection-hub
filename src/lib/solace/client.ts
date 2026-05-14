import solace from 'solclientjs';

// Initialize Solace factory
const factoryProps = new solace.SolclientFactoryProperties();
factoryProps.profile = solace.SolclientFactoryProfiles.version10;
solace.SolclientFactory.init(factoryProps);

export interface SolaceConfig {
  url: string;
  vpnName: string;
  userName: string;
  password: string;
}

export class SolaceClient {
  private session: solace.Session | null = null;
  private connected = false;
  private subscriptions = new Map<string, (message: solace.Message) => void>();

  constructor(private config: SolaceConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.session = solace.SolclientFactory.createSession({
          url: this.config.url,
          vpnName: this.config.vpnName,
          userName: this.config.userName,
          password: this.config.password,
          connectTimeoutInMsecs: 10000,
          reconnectRetries: 3,
          reconnectRetryWaitInMsecs: 1000,
        });

        this.session.on(solace.SessionEventCode.UP_NOTICE, () => {
          this.connected = true;
          console.log('[Solace] Connected to broker');
          resolve();
        });

        this.session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (event) => {
          console.error('[Solace] Connection failed:', event.infoStr);
          reject(new Error(`Connection failed: ${event.infoStr}`));
        });

        this.session.on(solace.SessionEventCode.DISCONNECTED, () => {
          this.connected = false;
          console.log('[Solace] Disconnected');
        });

        this.session.on(solace.SessionEventCode.SUBSCRIPTION_OK, (event) => {
          console.log('[Solace] Subscription confirmed:', event.correlationKey);
        });

        this.session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (event) => {
          console.error('[Solace] Subscription error:', event.infoStr);
        });

        this.session.on(solace.SessionEventCode.MESSAGE, (message) => {
          const topic = message.getDestination()?.getName() || '';
          this.handleMessage(topic, message);
        });

        this.session.connect();
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(topic: string, message: solace.Message): void {
    // Find matching subscription (support wildcards)
    for (const [pattern, callback] of this.subscriptions) {
      if (this.matchTopic(pattern, topic)) {
        callback(message);
      }
    }
  }

  private matchTopic(pattern: string, topic: string): boolean {
    // Convert Solace wildcard pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '[^/]+')
      .replace(/>/g, '.*');
    return new RegExp(`^${regexPattern}$`).test(topic);
  }

  subscribe(topic: string, callback: (message: solace.Message) => void): void {
    if (!this.session || !this.connected) {
      throw new Error('Not connected to Solace');
    }

    this.subscriptions.set(topic, callback);
    
    const topicDestination = solace.SolclientFactory.createTopicDestination(topic);
    this.session.subscribe(
      topicDestination,
      true, // request confirmation
      topic, // correlation key
      10000 // timeout
    );
    
    console.log('[Solace] Subscribed to:', topic);
  }

  unsubscribe(topic: string): void {
    if (!this.session || !this.connected) return;

    this.subscriptions.delete(topic);
    
    const topicDestination = solace.SolclientFactory.createTopicDestination(topic);
    this.session.unsubscribe(topicDestination, true, topic, 10000);
    
    console.log('[Solace] Unsubscribed from:', topic);
  }

  /**
   * Atomically switch subscription from one topic to another.
   * Used for dynamic topic filtering - Solace does the filtering server-side.
   */
  resubscribe(
    oldTopic: string,
    newTopic: string,
    callback: (message: solace.Message) => void
  ): void {
    if (!this.session || !this.connected) {
      throw new Error('Not connected to Solace');
    }

    // Unsubscribe from old topic
    if (this.subscriptions.has(oldTopic)) {
      this.subscriptions.delete(oldTopic);
      const oldDestination = solace.SolclientFactory.createTopicDestination(oldTopic);
      this.session.unsubscribe(oldDestination, true, oldTopic, 10000);
      console.log('[Solace] Unsubscribed from:', oldTopic);
    }

    // Subscribe to new topic
    this.subscriptions.set(newTopic, callback);
    const newDestination = solace.SolclientFactory.createTopicDestination(newTopic);
    this.session.subscribe(newDestination, true, newTopic, 10000);
    console.log('[Solace] Resubscribed to:', newTopic);
  }

  /**
   * Get the topic name from a message destination.
   */
  static getMessageTopic(message: solace.Message): string {
    return message.getDestination()?.getName() || '';
  }

  publish(topic: string, payload: object): void {
    if (!this.session || !this.connected) {
      throw new Error('Not connected to Solace');
    }

    const message = solace.SolclientFactory.createMessage();
    message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
    message.setBinaryAttachment(JSON.stringify(payload));
    message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);

    this.session.send(message);
  }

  publishPersistent(queueName: string, payload: object): void {
    if (!this.session || !this.connected) {
      throw new Error('Not connected to Solace');
    }

    const message = solace.SolclientFactory.createMessage();
    message.setDestination(solace.SolclientFactory.createQueueDestination(queueName));
    message.setBinaryAttachment(JSON.stringify(payload));
    message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);

    this.session.send(message);
  }

  disconnect(): void {
    if (this.session && this.connected) {
      this.session.disconnect();
      this.session = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  static parseMessage<T>(message: solace.Message): T {
    let str = '';
    const topic = message.getDestination()?.getName() || 'unknown';
    
    // Method 1: Try SDT container (used by SAM gateway output handlers)
    try {
      const sdtContainer = message.getSdtContainer();
      if (sdtContainer) {
        const value = sdtContainer.getValue();
        if (typeof value === 'string') {
          str = value;
        } else if (value && typeof value === 'object') {
          return value as T;
        }
      }
    } catch {
      // SDT container not available
    }
    
    // Method 2: Try binary attachment
    if (!str) {
      try {
        const payload = message.getBinaryAttachment();
        if (typeof payload === 'string') {
          str = payload;
        } else if (payload) {
          const decoder = new TextDecoder('utf-8', { fatal: false });
          str = decoder.decode(payload as Uint8Array);
        }
      } catch {
        // Binary attachment not available
      }
    }
    
    // Method 3: Try XML content
    if (!str) {
      try {
        const xml = message.getXmlContent();
        if (xml) str = xml;
      } catch {
        // XML not available
      }
    }
    
    if (!str) {
      throw new Error('No payload found in message');
    }
    
    // Clean up non-printable characters
    str = str.replace(/^[\x00-\x1f]+/, '').replace(/[\x00-\x1f]+$/, '').trim();
    
    // SAM gateway sends messages as JSON string literals: "text here" 
    // First, try to unwrap if it's a JSON string literal
    if (str.startsWith('"') && str.endsWith('"')) {
      try {
        const unwrapped = JSON.parse(str);
        if (typeof unwrapped === 'string') {
          str = unwrapped;
        }
      } catch {
        // Not a valid JSON string, continue with original
      }
    }
    
    // Remove markdown code blocks: ```json ... ``` or ``` ... ```
    str = str.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
    
    // Try to parse as JSON directly first
    try {
      return JSON.parse(str);
    } catch {
      // Not direct JSON, try to extract
    }
    
    // Extract JSON object or array from the text
    const jsonMatch = str.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!jsonMatch) {
      // No JSON found - this might be plain text response from LLM
      // Return a wrapper object for plain text
      console.warn(`[parseMessage:${topic}] No JSON found, returning text wrapper`);
      return { _text: str, _isPlainText: true } as T;
    }
    
    let jsonStr = jsonMatch[1];
    
    // Fix common LLM JSON issues
    jsonStr = jsonStr
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      .replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas
    
    return JSON.parse(jsonStr);
  }
}

// Singleton instance for server-side usage
let serverClient: SolaceClient | null = null;

export function getSolaceClient(): SolaceClient {
  if (!serverClient) {
    serverClient = new SolaceClient({
      url: process.env.SOLACE_URL || 'ws://localhost:8008',
      vpnName: process.env.SOLACE_VPN || 'sam',
      userName: process.env.SOLACE_USERNAME || 'sam',
      password: process.env.SOLACE_PASSWORD || 'sam',
    });
  }
  return serverClient;
}
