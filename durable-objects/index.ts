import { DurableObject } from "cloudflare:workers";
import crossws from "crossws/adapters/cloudflare";

const MAX_MESSAGE_SIZE = 1024 * 10; // 10KB

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
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const tokenBytes = new Uint8Array(
    tokenHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
  );

  return crypto.subtle.verify("HMAC", key, tokenBytes, data);
}

async function extractConnectionData(request: Request, secret: string) {
  const protocolHeader = request.headers.get("sec-websocket-protocol");
  if (!protocolHeader) throw new Error("Missing sec-websocket-protocol header");

  const [encoded] = protocolHeader.split(",").map((x) => x.trim());
  if (!encoded) throw new Error("Invalid sec-websocket-protocol format");

  const decoded = atob(encoded);
  const [decisionId, verticalKey, userEmail, token] = decoded.split(":");
  if (!decisionId || !verticalKey || !userEmail || !token) {
    throw new Error("Invalid connection data");
  }

  const isValid = await verifyHmacToken(
    decisionId,
    verticalKey,
    userEmail,
    token,
    secret
  );
  if (!isValid) throw new Error("Unauthorized");

  const room = `${decisionId}__${verticalKey}`;
  return { room, userEmail, decisionId, verticalKey };
}

const ws = crossws({
  hooks: {
    async open(peer) {
      try {
        const req = peer.request as Request;
        const WEBSOCKET_SECRET = peer.request.headers.get('cf-ws-secret')!;

        const { room, userEmail, decisionId, verticalKey } =
          await extractConnectionData(req, WEBSOCKET_SECRET);

        // attach metadata to peer
        peer.data = { room, userEmail, decisionId, verticalKey };

        // join room
        peer.subscribe(room);

        // broadcast join message
        peer.publish(room, {
          type: "join",
          userEmail,
          decisionId,
          verticalKey,
          time: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Auth error:", err);
        peer.close(1008, "Unauthorized");
      }
    },

    async message(peer, message) {
      const meta = peer.data as {
        room: string;
        userEmail: string;
        decisionId: string;
        verticalKey: string;
      };
      if (!meta) {
        peer.close(1003, "Missing session");
        return;
      }

      const { room, userEmail, decisionId, verticalKey } = meta;
      if (typeof message !== "string") {
        peer.close(1003, "Invalid message type");
        return;
      }
      if (message.length > MAX_MESSAGE_SIZE) {
        peer.close(1009, "Message too large");
        return;
      }

      try {
        const parsed = JSON.parse(message);

        if (parsed.type === "chat") {
          if (!parsed.text || typeof parsed.text !== "string") {
            throw new Error("Invalid chat message");
          }
          peer.publish(room, {
            type: "chat",
            userEmail,
            text: parsed.text,
            time: new Date().toISOString(),
            decisionId,
            verticalKey,
          });
        } else if (parsed.type === "name") {
          if (!parsed.name || typeof parsed.name !== "string") {
            throw new Error("Invalid name");
          }
          peer.publish(room, {
            type: "name",
            userEmail,
            name: parsed.name.trim(),
            time: new Date().toISOString(),
            decisionId,
            verticalKey,
          });
        } else {
          throw new Error("Unknown message type");
        }
      } catch (err) {
        console.error("Message error:", err);
        peer.close(1003, "Invalid message");
      }
    },

    close(peer, event) {
      const meta = peer.data;
      console.log("[ws] close", meta?.userEmail, event);
    },

    error(peer, error) {
      console.error("[ws] error", peer.data?.userEmail, error);
    },
  },
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export class WEBSOCKETS extends DurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    ws.handleDurableInit(this, state, env);
  }

  fetch(request: Request) {
    return ws.handleDurableUpgrade(this, request);
  }

  webSocketMessage(client: WebSocket, message: ArrayBuffer | string) {
    return ws.handleDurableMessage(this, client, message);
  }

  webSocketPublish(topic: string, message: any, opts: any) {
    return ws.handleDurablePublish(this, topic, message, opts);
  }

  webSocketClose(client: WebSocket, code: number, reason: string, wasClean: boolean) {
    return ws.handleDurableClose(this, client, code, reason, wasClean);
  }
}
