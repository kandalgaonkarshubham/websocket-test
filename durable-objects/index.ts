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

// Global storage for connection data and active peers
let globalEnv: Env;
let globalDurableObject: any;
const activePeers = new Map<string, any>();

// Create crossws instance
const ws = crossws({
  bindingName: "WEBSOCKETS",
  instanceName: "crossws",
  hooks: {
    async open(peer) {
      console.log("[crossws] WebSocket opened", peer.id);

      try {
        // Extract connection data directly from the request
        // Since crossws upgrade hook doesn't reliably pass data, we extract it here again
        const secret = globalEnv?.NUXT_WEBSOCKET_SECRET;
        if (!secret) {
          throw new Error('Missing websocket secret');
        }

        // Get the request from peer - this should contain the original request
        const request = peer.request || globalDurableObject?.lastRequest;
        if (!request) {
          throw new Error('No request found in peer context');
        }

        const { room, userEmail, decisionId, verticalKey } =
          await extractConnectionData(request, secret);

        // Store connection data in peer
        peer.connectionData = { room, userEmail, decisionId, verticalKey };

        // Check for existing connections and close them
        const existing = activePeers.get(userEmail);
        if (existing && existing !== peer) {
          console.log(`[crossws] Closing old connection for ${userEmail}`);
          try {
            existing.close(4000, 'Another connection opened');
          } catch (e) {
            console.log('Error closing old connection:', e);
          }
        }

        // Store the new connection
        activePeers.set(userEmail, peer);

        // Subscribe to the room
        peer.subscribe(room);

        console.log(`[crossws] User ${userEmail} joined room ${room}`);

      } catch (error) {
        console.error('[crossws] Connection error:', error);
        peer.close(1003, 'Connection failed');
      }
    },

    async message(peer, message) {
      console.log("[crossws] Message received", message.text());

      try {
        const connectionData = peer.connectionData as WebSocketData;
        if (!connectionData) {
          console.error('[crossws] No connection data in peer');
          peer.close(1003, 'Session not found');
          return;
        }

        const { room, userEmail, decisionId, verticalKey } = connectionData;
        const messageText = message.text();

        if (messageText.length > MAX_MESSAGE_SIZE) {
          console.error('[crossws] Message too large:', messageText.length);
          peer.close(1009, 'Message too large');
          return;
        }

        const parsed = JSON.parse(messageText) as WebSocketMessage;

        if (parsed.type === 'chat') {
          if (typeof parsed.text !== 'string' || parsed.text.trim().length === 0) {
            throw new Error('Invalid chat message');
          }

          // Get stored name from durable object storage
          let userName = userEmail; // fallback
          if (globalDurableObject?.state?.storage) {
            try {
              userName = await globalDurableObject.state.storage.get(`name:${userEmail}`) || userEmail;
            } catch (e) {
              console.log('Error getting stored name:', e);
            }
          }

          const chatData = {
            type: 'chat',
            userEmail,
            userName,
            text: parsed.text,
            time: new Date().toISOString(),
            decisionId,
            verticalKey
          };

          console.log('[crossws] Publishing chat message to room:', room);
          peer.publish(room, chatData);

        } else if (parsed.type === 'name') {
          if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
            throw new Error('Invalid name');
          }

          // Store the name in durable object storage
          if (globalDurableObject?.state?.storage) {
            try {
              await globalDurableObject.state.storage.put(`name:${userEmail}`, parsed.name.trim());
              console.log('[crossws] Stored name:', parsed.name.trim());
            } catch (e) {
              console.log('Error storing name:', e);
            }
          }

          const nameData = {
            type: 'name',
            userEmail,
            name: parsed.name.trim(),
            time: new Date().toISOString(),
            decisionId,
            verticalKey
          };

          console.log('[crossws] Publishing name update to room:', room);
          peer.publish(room, nameData);

        } else {
          throw new Error('Unknown message type');
        }

      } catch (error) {
        console.error('[crossws] Message processing error:', error);
        peer.close(1003, 'Invalid message format');
      }
    },

    async close(peer, event) {
      console.log("[crossws] WebSocket closed", peer.id, event);

      try {
        const connectionData = peer.connectionData as WebSocketData;
        if (connectionData) {
          console.log(`[crossws] User ${connectionData.userEmail} left room ${connectionData.room}`);

          // Remove from active peers
          activePeers.delete(connectionData.userEmail);

          // Clean up stored name data
          if (globalDurableObject?.state?.storage) {
            try {
              await globalDurableObject.state.storage.delete(`name:${connectionData.userEmail}`);
            } catch (e) {
              console.log('Error cleaning up storage:', e);
            }
          }
        }
      } catch (error) {
        console.error('[crossws] Close cleanup error:', error);
      }
    },

    async error(peer, error) {
      console.error("[crossws] WebSocket error", peer.id, error);

      try {
        const connectionData = peer.connectionData as WebSocketData;
        if (connectionData) {
          activePeers.delete(connectionData.userEmail);

          // Clean up storage
          if (globalDurableObject?.state?.storage) {
            try {
              await globalDurableObject.state.storage.delete(`name:${connectionData.userEmail}`);
            } catch (e) {
              console.log('Error cleaning up storage on error:', e);
            }
          }
        }
      } catch (cleanupError) {
        console.error('[crossws] Error cleanup failed:', cleanupError);
      }
    }
  }
});

// Main worker export
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Store env globally for access in hooks
    globalEnv = env;

    // Handle WebSocket upgrade requests
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      try {
        return ws.handleUpgrade(request, env, ctx);
      } catch (error) {
        console.error('Error in worker fetch:', error);
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
    }

    return new Response('Expected WebSocket', { status: 400 });
  }
};

// Durable Object class
export class WEBSOCKETS extends DurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    globalEnv = env;
    globalDurableObject = this;
    ws.handleDurableInit(this, state, env);
  }

  fetch(request: Request) {
    // Store the request for potential use in hooks
    this.lastRequest = request;
    return ws.handleDurableUpgrade(this, request);
  }

  webSocketMessage(client: WebSocket, message: ArrayBuffer | string) {
    return ws.handleDurableMessage(this, client, message);
  }

  webSocketClose(client: WebSocket, code: number, reason: string, wasClean: boolean) {
    return ws.handleDurableClose(this, client, code, reason, wasClean);
  }

  webSocketPublish(topic: string, message: unknown, opts: any) {
    return ws.handleDurablePublish(this, topic, message, opts);
  }
}
