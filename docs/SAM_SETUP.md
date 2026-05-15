# SAM Enterprise Setup for Fraud Detection Hub

This document describes the setup for connecting the Fraud Detection Hub dashboard to SAM Enterprise running on Minikube.

## Architecture Overview

```
┌─────────────────────┐     ┌─────────────────────────────────┐
│   Next.js Dashboard │     │         Minikube                │
│   (localhost:3000)  │     │  ┌─────────────────────────┐   │
│                     │     │  │  SAM Enterprise         │   │
│  ┌───────────────┐  │     │  │  (NodePort Service)     │   │
│  │ /api/chat     │──┼─────┼──│  - Port 80 (webui/API)  │   │
│  │ route.ts      │  │     │  │  - Port 8080 (platform) │   │
│  └───────────────┘  │     │  │  - Port 5050 (auth)     │   │
│                     │     │  └─────────────────────────┘   │
│  ┌───────────────┐  │     │                                │
│  │ Simulator     │──┼─────┼──► Solace Cloud (AWS)          │
│  └───────────────┘  │     │                                │
└─────────────────────┘     └─────────────────────────────────┘
                                        │
                                        ▼
                            ┌─────────────────────────┐
                            │  Solace Cloud Broker    │
                            │  (himanshu-demo VPN)    │
                            └─────────────────────────┘
```

## Prerequisites

- Minikube running with SAM Enterprise deployed via Helm
- Solace Cloud broker (or local Solace broker)
- PostgreSQL for fraud detection data

## Configuration Steps

### 1. Expose SAM Service via NodePort

The SAM service is deployed as ClusterIP by default. Convert it to NodePort for external access:

```bash
kubectl patch svc agent-mesh-solace-agent-mesh-core -p '{"spec": {"type": "NodePort"}}'
```

Verify the service:
```bash
kubectl get svc agent-mesh-solace-agent-mesh-core
```

Expected output shows NodePort mappings:
- Port 80 (webui/API) → 31786 (example)
- Port 8080 (platform) → 30254 (example)
- Port 5050 (auth) → 31637 (example)

### 2. Create Minikube Tunnel (macOS)

On macOS, NodePorts aren't directly accessible. Use `minikube service` to create a tunnel:

```bash
minikube service agent-mesh-solace-agent-mesh-core --url
```

This outputs multiple URLs (one per port). Keep this terminal open.

Example output:
```
http://127.0.0.1:64735  # Port 443 (TLS)
http://127.0.0.1:64736  # Port 4443 (platform TLS)
http://127.0.0.1:64737  # Port 80 (webui/API) ← Use this for SAM_URL
http://127.0.0.1:64738  # Port 8080 (platform)
http://127.0.0.1:64739  # Port 5050 (auth)
```

**Important:** The tunnel URL ports are dynamic and change each time you restart the command.

### 3. Identify the Correct API Port

Test each URL to find the webui API (port 80):

```bash
curl -s http://127.0.0.1:64737/api/v1/agentCards | jq '.[].name'
```

A successful response lists registered agents.

### 4. Update Dashboard Configuration

Edit `.env.local` with the tunnel URL:

```env
# SAM A2A API (SAM via minikube service tunnel)
SAM_URL=http://127.0.0.1:64737
```

### 5. Restart Next.js

```bash
pkill -f "next dev"
npm run dev
```

## SAM API Reference

The SAM API documentation is available at `/docs` endpoint:

```bash
curl http://127.0.0.1:64737/docs
```

Or get the OpenAPI spec:
```bash
curl http://127.0.0.1:64737/openapi.json | jq '.paths | keys'
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/message:stream` | POST | Submit a chat message (returns task ID) |
| `/api/v1/sse/subscribe/{task_id}` | GET | Subscribe to SSE stream for task updates |
| `/api/v1/tasks/{task_id}` | GET | Get task status and result |
| `/api/v1/agentCards` | GET | List available agents |
| `/health` | GET | Health check |

### Example: Submit a Message

```bash
curl -X POST http://127.0.0.1:64737/api/v1/message:stream \
  -H "Content-Type: application/json" \
  -d '{
    "id": "req-123",
    "jsonrpc": "2.0",
    "method": "message/stream",
    "params": {
      "message": {
        "contextId": "ctx-123",
        "kind": "message",
        "messageId": "msg-123",
        "metadata": { "agent_name": "OrchestratorAgent" },
        "parts": [{ "kind": "text", "text": "Hello" }],
        "role": "user"
      }
    }
  }'
```

## Agent Configuration

### Available Agents

Check registered agents:
```bash
curl http://127.0.0.1:64737/api/v1/agentCards | jq '.[] | {name, url}'
```

The Orchestrator agent is named `OrchestratorAgent` (not `Orchestrator`).

### Dashboard Chat Route

The chat route ([src/app/api/chat/route.ts](../src/app/api/chat/route.ts)) uses:

```typescript
const TARGET_AGENT = "OrchestratorAgent";
```

## Troubleshooting

### SSE Connection Drops

**Symptom:** Chat returns fallback message, SSE errors in logs.

**Cause:** `kubectl port-forward` is unreliable for long-running SSE connections.

**Solution:** Use NodePort + minikube tunnel instead of port-forward.

### Agent Not Found

**Symptom:** Task submitted but no response.

**Check:**
1. Verify agent name: `curl .../api/v1/agentCards | jq '.[].name'`
2. Use exact agent name (case-sensitive): `OrchestratorAgent`

### Tunnel URL Changed

**Symptom:** Connection refused errors after restart.

**Solution:** 
1. Re-run `minikube service agent-mesh-solace-agent-mesh-core --url`
2. Update `SAM_URL` in `.env.local` with new port
3. Restart Next.js

### Check Task Status

If a task seems stuck:
```bash
curl http://127.0.0.1:64737/api/v1/tasks/{task_id}
```

## Current Configuration

### .env.local
```env
# SAM A2A API (SAM via minikube service tunnel)
SAM_URL=http://127.0.0.1:64737

# Solace Cloud Broker Configuration (AWS)
SOLACE_URL=ws://mr-connection-jhe3byjjs17.messaging.solace.cloud:80
SOLACE_VPN=himanshu-demo
SOLACE_USERNAME=sam
SOLACE_PASSWORD=sam

# Client-side Solace config
NEXT_PUBLIC_SOLACE_URL=ws://mr-connection-jhe3byjjs17.messaging.solace.cloud:80
NEXT_PUBLIC_SOLACE_VPN=himanshu-demo
NEXT_PUBLIC_SOLACE_USERNAME=sam
NEXT_PUBLIC_SOLACE_PASSWORD=sam

# Simulator Mode
SIMULATOR_MODE=sam
NEXT_PUBLIC_SIMULATOR_MODE=sam
```

### Active Services

| Service | Access Method | URL |
|---------|--------------|-----|
| SAM Enterprise | Minikube tunnel | http://127.0.0.1:64737 |
| Dashboard | Direct | http://localhost:3000 |
| Solace Cloud | WebSocket | ws://mr-connection-jhe3byjjs17.messaging.solace.cloud:80 |
| PostgreSQL | kubectl port-forward | localhost:5432 |

## Quick Start Checklist

1. ✅ Start Minikube: `minikube start`
2. ✅ Verify SAM pods: `kubectl get pods | grep agent-mesh`
3. ✅ Convert to NodePort: `kubectl patch svc agent-mesh-solace-agent-mesh-core -p '{"spec": {"type": "NodePort"}}'`
4. ✅ Start tunnel: `minikube service agent-mesh-solace-agent-mesh-core --url` (keep open)
5. ✅ Update `.env.local` with tunnel URL for port 80
6. ✅ Start dashboard: `npm run dev`
7. ✅ Test chat in dashboard UI
