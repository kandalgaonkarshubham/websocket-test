# Nuxt Minimal Starter with WebSocket + Durable Objects Project

## Alternative approach (Unstable): [crossws-branch](https://github.com/kandalgaonkarshubham/websocket-test/tree/crossws)

This repository contains two separate Cloudflare Worker projects:

1. **Root Worker (`websocket-test`)** – Main Worker(Nuxt) project.
2. **Durable Objects Worker (`durable-objects`)** – Handles WebSocket connections using Durable Objects.

---

## Local Development

Run:

```bash
pnpm run dev:ws
```
  In a seperate terminal to start the websocket server on port:8787

---

## Deployment (Github Actions)

### 1. Root Worker

Deploy the root Worker (Nuxt) from the root folder:

```bash
wrangler deploy
```

### 2. Durable Objects Worker

Deploy the durable-objects Worker:

```bash
cd durable-objects
wrangler deploy --config wrangler.jsonc
```
---

## Deployments


- Worker (Nuxt): https://websocket-test.shubham-ad0.workers.dev/
- Worker (Websockets): https://durable-objects.shubham-ad0.workers.dev/ wss://durable-objects.shubham-ad0.workers.dev/
