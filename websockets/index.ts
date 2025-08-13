/// <reference types="@cloudflare/workers-types" />

const MAX_MESSAGE_SIZE = 1024 * 10; // 10KB

interface ChatMessage {
  type: 'chat';
  text: string;
}

interface NameUpdateMessage {
  type: 'name';
  name: string;
}

type WebSocketMessage = ChatMessage | NameUpdateMessage;

interface WebSocketData {
  room: string;
  userEmail: string;
  decisionId: string;
  verticalKey: string;
}

interface Env {
  WEBSOCKETS: DurableObjectNamespace;
  NUXT_WEBSOCKET_SECRET: string;
}

async function verifyHmacToken(
  decisionId: string,
  verticalKey: string,
  email: string,
  tokenHex: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${decisionId}:${verticalKey}:${email}`);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Convert hex token to Uint8Array
  const tokenBytes = new Uint8Array(
    tokenHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const valid = await crypto.subtle.verify('HMAC', key, tokenBytes, data);
  return valid;
}

async function extractConnectionData(
  request: Request,
  secret: string
): Promise<{
  room: string;
  userEmail: string;
  decisionId: string;
  verticalKey: string;
}> {
  const protocolHeader = request.headers.get('sec-websocket-protocol');
  if (!protocolHeader) {
    throw new Error('Missing sec-websocket-protocol header');
  }
  const [encoded] = protocolHeader.split(',').map((x) => x.trim());
  if (!encoded) {
    throw new Error('Invalid sec-websocket-protocol format');
  }
  const decoded = atob(encoded);

  // Expected format: decisionId:verticalKey:userEmail
  const [decisionId, verticalKey, userEmail, token] = decoded.split(':');
  if (!decisionId || !verticalKey || !userEmail || !token) {
    throw new Error(
      'DecisionId, VerticalKey, and User ID must be provided and separated by colons'
    );
  }

  const isValid = await verifyHmacToken(
    decisionId,
    verticalKey,
    userEmail,
    token,
    secret
  );
  if (!isValid) {
    throw new Error('Unauthorized');
  }

  // Create unique room identifier using decisionId and verticalKey
  const room = `${decisionId}__${verticalKey}`;

  return { room, userEmail, decisionId, verticalKey };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const binding = env.WEBSOCKETS as DurableObjectNamespace;
    const secret = env.NUXT_WEBSOCKET_SECRET;

    // Reject non-WebSocket upgrade requests early
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      console.log('Non-WS request, sending response');
      return new Response('Expected WebSocket', { status: 400 });
    }

    try {
      const { room } = await extractConnectionData(request, secret);
      return binding.get(binding.idFromName(room)).fetch(request);
    } catch (err) {
      console.error('Error in worker fetch:', err);
      return new Response(null, { status: 400 });
    }
  }
};

export class WebSockets implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private ctx: ExecutionContext;
  private sessions: Map<WebSocket, WebSocketData>;
  private secret: string;

  constructor(state: DurableObjectState, env: Env, ctx: ExecutionContext) {
    this.state = state;
    this.env = env;
    this.ctx = ctx;
    this.sessions = new Map();

    // access secrets
    this.secret = env.NUXT_WEBSOCKET_SECRET;

    // Restore hibernated WebSocket connections
    this.state.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment() as WebSocketData;
      if (attachment) {
        this.sessions.set(ws, attachment);
      }
    });
  }

  async publish(room: string, data: unknown): Promise<void> {
    try {
      // Use sessions map for better performance with hibernation
      const toRemove: WebSocket[] = [];

      for (const [ws, wsData] of this.sessions.entries()) {
        if (wsData.room === room) {
          try {
            ws.send(JSON.stringify(data));
          } catch (err) {
            // Connection is closed, mark for removal
            console.error('Failed to send to WebSocket:', err);
            toRemove.push(ws);
          }
        }
      }
      // Clean up closed connections
      toRemove.forEach((ws) => this.sessions.delete(ws));
    } catch (err) {
      console.error('publish err', err);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    try {
      const { room, userEmail, decisionId, verticalKey } =
        await extractConnectionData(request, this.secret);
      const protocols =
        request.headers
          .get('sec-websocket-protocol')
          ?.split(',')
          .map((x) => x.trim()) || [];
      protocols.shift(); // remove the encoded connection data from protocols

      // Create WebSocket pair
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      const wsData = {
        room,
        userEmail,
        decisionId,
        verticalKey
      };

      // Serialize attachment BEFORE accepting
      server.serializeAttachment(wsData);

      // Use hibernation-enabled acceptWebSocket (NOT ws.accept())
      this.state.acceptWebSocket(server);

      // Add to sessions map for hibernation support
      this.sessions.set(server, wsData);

      // Handle WebSocket errors
      server.addEventListener('error', (event) => {
        console.log('WebSocket error:', event);
        this.sessions.delete(server);
      });

      // Create response
      const res = new Response(null, { status: 101, webSocket: client });
      if (protocols.length > 0) {
        res.headers.set('sec-websocket-protocol', protocols[0] as string);
      }
      return res;
    } catch (err) {
      console.error('Error in websocket fetch:', err);
      return new Response(null, { status: 400 });
    }
  }

  async webSocketMessage(
    ws: WebSocket,
    message: ArrayBuffer | string
  ): Promise<void> {
    const wsData = this.sessions.get(ws);
    if (!wsData) {
      console.error('WebSocket not found in sessions');
      ws.close(1003, 'Session not found');
      return;
    }

    const { room, userEmail, decisionId, verticalKey } = wsData;

    // Validate message type and size
    if (typeof message !== 'string') {
      console.error(`Invalid message type: ${typeof message}`);
      ws.close(1003, 'Invalid message type');
      return;
    }
    if (message.length > MAX_MESSAGE_SIZE) {
      console.error(`Message too large: ${message.length} bytes`);
      ws.close(1009, 'Message too large');
      return;
    }

    try {
      const parsed = JSON.parse(message) as WebSocketMessage;

      if (parsed.type === 'chat') {
        if (
          typeof parsed.text !== 'string' ||
          parsed.text.trim().length === 0
        ) {
          throw new Error('Invalid chat message');
        }
        const userName =
          (await this.state.storage.get<string>(`name:${userEmail}`)) ||
          userEmail;
        await this.publish(room, {
          type: 'chat',
          userEmail,
          userName,
          text: parsed.text,
          time: new Date().toISOString(),
          decisionId,
          verticalKey
        });
      } else if (parsed.type === 'name') {
        if (
          typeof parsed.name !== 'string' ||
          parsed.name.trim().length === 0
        ) {
          throw new Error('Invalid name');
        }
        await this.state.storage.put(`name:${userEmail}`, parsed.name.trim());
        await this.publish(room, {
          type: 'name',
          userEmail,
          name: parsed.name.trim(),
          time: new Date().toISOString(),
          decisionId,
          verticalKey
        });
      } else {
        throw new Error('Unknown message type');
      }
    } catch (err) {
      console.error('Message processing error:', err);
      ws.close(1003, 'Invalid message format');
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    console.log(`WebSocket closing: code=${code}, reason=${reason}`);

    const wsData = this.sessions.get(ws);
    if (wsData) {
      try {
        // Clean up stored name data
        await this.state.storage.delete(`name:${wsData.userEmail}`);
      } catch (err) {
        console.error('Error cleaning up storage:', err);
      }
      // Remove from sessions map
      this.sessions.delete(ws);
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);

    // Clean up session data
    const wsData = this.sessions.get(ws);
    if (wsData) {
      try {
        await this.state.storage.delete(`name:${wsData.userEmail}`);
      } catch (err) {
        console.error('Error cleaning up storage on error:', err);
      }
      this.sessions.delete(ws);
    }
  }
}
