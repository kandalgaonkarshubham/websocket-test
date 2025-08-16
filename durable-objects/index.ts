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

// Global storage for connection data by peer ID
const peerConnectionData = new Map<string, WebSocketData>();

// Global storage for connection data and active peers
let globalEnv: Env;
let globalDurableObject: any;

// Create crossws instance
const ws = crossws({
  bindingName: "WEBSOCKETS",
  instanceName: "crossws",
  hooks: {
    async upgrade(request) {
      // Handle authentication in upgrade hook
      try {
        const secret = globalEnv?.NUXT_WEBSOCKET_SECRET;
        if (!secret) {
          console.error('[crossws] Missing websocket secret in globalEnv:', !!globalEnv);
          throw new Error('Missing websocket secret');
        }

        const { room, userEmail, decisionId, verticalKey } =
          await extractConnectionData(request, secret);

        console.log(`[crossws] Authentication successful for: ${userEmail}, room: ${room}`);

        // Generate a temporary ID to link upgrade to open
        const tempId = crypto.randomUUID();
        peerConnectionData.set(tempId, { room, userEmail, decisionId, verticalKey });

        // Return namespace and the tempId in context
        return {
          namespace: room,
          context: { tempId }
        };

      } catch (error) {
        console.error('[crossws] Authentication failed:', error);
        return {
          endResponse: new Response('Unauthorized', { status: 401 })
        };
      }
    },

    async open(peer) {
      console.log("[crossws] WebSocket opened", peer.id);
      console.log("[crossws] Peer context:", peer.context);

      try {
        // Get connection data using tempId
        const tempId = peer.context?.tempId;
        let connectionData = null;

        if (tempId) {
          connectionData = peerConnectionData.get(tempId);
          peerConnectionData.delete(tempId); // Clean up temp storage
        }

        // Fallback: try to extract from peer.request if available
        if (!connectionData && peer.request) {
          console.log('[crossws] Fallback: extracting from peer.request');
          const secret = globalEnv?.NUXT_WEBSOCKET_SECRET;
          if (secret) {
            try {
              connectionData = await extractConnectionData(peer.request, secret);
            } catch (e) {
              console.log('[crossws] Fallback extraction failed:', e);
            }
          }
        }

        if (!connectionData || !connectionData.room || !connectionData.userEmail) {
          console.error('[crossws] Invalid connection data:', connectionData);
          throw new Error('No connection data available');
        }

        const { room, userEmail, decisionId, verticalKey } = connectionData;

        // Store connection data in peer for easy access
        peer.connectionData = { room, userEmail, decisionId, verticalKey };

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

          // send data back to sender
          peer.send(chatData);

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
    // Store env globally BEFORE handling upgrade
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
