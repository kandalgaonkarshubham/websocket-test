import { DurableObject } from "cloudflare:workers";
import crossws from "crossws/adapters/cloudflare";

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
  const [decisionId, verticalKey, userEmail, token] = decoded.split(':');

  if (!decisionId || !verticalKey || !userEmail || !token) {
    throw new Error('DecisionId, VerticalKey, and User ID must be provided and separated by colons');
  }

  const isValid = await verifyHmacToken(decisionId, verticalKey, userEmail, token, secret);
  if (!isValid) {
    throw new Error('Unauthorized');
  }

  const room = `${decisionId}__${verticalKey}`;
  return { room, userEmail, decisionId, verticalKey };
}

// Create crossws instance
const ws = crossws({
  bindingName: "WEBSOCKETS", // Your durable object binding name
  instanceName: "crossws",
  hooks: {
    async open(peer) {
      try {
        const request = peer.request;
        const WEBSOCKET_SECRET = peer.request.headers.get('cf-ws-secret')!;

        // Extract connection data from the request
        const { room, userEmail, decisionId, verticalKey } =
          await extractConnectionData(request, WEBSOCKET_SECRET);

        // Store connection data in peer context
        peer.ctx = { room, userEmail, decisionId, verticalKey };

        // Subscribe to the room for pub/sub
        peer.subscribe(room);

        console.log(`[ws] User ${userEmail} joined room ${room}`);
      } catch (error) {
        console.error('[ws] Connection error:', error);
        peer.close(1003, 'Connection failed');
      }
    },

    async message(peer, message) {
      console.log('[ws] Received message:', message.text());

      try {
        const ctx = peer.ctx as WebSocketData;
        if (!ctx) {
          console.error('[ws] No context found for peer');
          peer.close(1003, 'Session not found');
          return;
        }

        const { room, userEmail, decisionId, verticalKey } = ctx;
        const messageText = message.text();

        console.log('[ws] Processing message for user:', userEmail, 'in room:', room);

        if (messageText.length > MAX_MESSAGE_SIZE) {
          console.error('[ws] Message too large:', messageText.length);
          peer.close(1009, 'Message too large');
          return;
        }

        const parsed = JSON.parse(messageText) as WebSocketMessage;
        console.log('[ws] Parsed message:', parsed);

        if (parsed.type === 'chat') {
          if (typeof parsed.text !== 'string' || parsed.text.trim().length === 0) {
            throw new Error('Invalid chat message');
          }

          // Get stored name or use email as fallback
          const userName = await peer.storage?.get(`name:${userEmail}`) || userEmail;
          console.log('[ws] Got username:', userName);

          const chatData = {
            type: 'chat',
            userEmail,
            userName,
            text: parsed.text,
            time: new Date().toISOString(),
            decisionId,
            verticalKey
          };

          console.log('[ws] Publishing chat message:', chatData);

          // Publish to all subscribers of this room
          await peer.publish(room, chatData);

        } else if (parsed.type === 'name') {
          if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
            throw new Error('Invalid name');
          }

          // Store the name
          await peer.storage?.put(`name:${userEmail}`, parsed.name.trim());
          console.log('[ws] Stored name:', parsed.name.trim());

          const nameData = {
            type: 'name',
            userEmail,
            name: parsed.name.trim(),
            time: new Date().toISOString(),
            decisionId,
            verticalKey
          };

          console.log('[ws] Publishing name update:', nameData);

          // Publish name update to room
          await peer.publish(room, nameData);

        } else {
          throw new Error('Unknown message type');
        }

      } catch (error) {
        console.error('[ws] Message processing error:', error);
        peer.close(1003, 'Invalid message format');
      }
    },

    async close(peer, event) {
      try {
        const ctx = peer.ctx as WebSocketData;
        if (ctx) {
          console.log(`[ws] User ${ctx.userEmail} left room ${ctx.room}`);

          // Clean up stored name data
          await peer.storage?.delete(`name:${ctx.userEmail}`);
        }
      } catch (error) {
        console.error('[ws] Close cleanup error:', error);
      }
    },

    async error(peer, error) {
      console.error('[ws] WebSocket error:', error);

      try {
        const ctx = peer.ctx as WebSocketData;
        if (ctx) {
          await peer.storage?.delete(`name:${ctx.userEmail}`);
        }
      } catch (cleanupError) {
        console.error('[ws] Error cleanup failed:', cleanupError);
      }
    }
  }
});

// Main worker export
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle WebSocket upgrade requests
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      try {
        const envEmbeddedReq = new Request(request, {
          headers: {
            ...Object.fromEntries(request.headers),
            'cf-ws-secret': env.NUXT_WEBSOCKET_SECRET,
          }
        });
        return ws.handleUpgrade(envEmbeddedReq, env, ctx);
      } catch (error) {
        console.error('Error in worker fetch:', error);
        return new Response(null, { status: 400 });
      }
    }

    return new Response('Expected WebSocket', { status: 400 });
  }
};

// Durable Object class
export class WEBSOCKETS extends DurableObject {
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.env = env;
    ws.handleDurableInit(this, state, env);
  }

  fetch(request: Request) {
    return ws.handleDurableUpgrade(this, request);
  }

  webSocketMessage(client: WebSocket, message: ArrayBuffer | string) {
    console.log('[DO] webSocketMessage called:', typeof message, message);
    client.ctx = { ...client.ctx, env: this.env };
    return ws.handleDurableMessage(this, client, message);
  }

  webSocketClose(client: WebSocket, code: number, reason: string, wasClean: boolean) {
    console.log('[DO] webSocketClose called:', code, reason);
    return ws.handleDurableClose(this, client, code, reason, wasClean);
  }

  webSocketError(client: WebSocket, error: unknown) {
    console.log('[DO] webSocketError called:', error);
    return ws.handleDurableError?.(this, client, error);
  }
}
