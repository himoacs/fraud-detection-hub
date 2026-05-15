# Changelog

## 2026-05-15 - SAM Chat Integration Fix

### Problem
Dashboard chat was failing with SSE connection errors when connecting to SAM Enterprise via `kubectl port-forward`. The SSE streams would terminate prematurely, causing fallback messages to appear instead of actual SAM responses.

### Root Cause
`kubectl port-forward` is not reliable for long-running SSE (Server-Sent Events) connections. The port-forward would drop connections before SSE streams could complete.

### Solution

#### 1. Changed SAM Service Type
Converted the SAM service from ClusterIP to NodePort:
```bash
kubectl patch svc agent-mesh-solace-agent-mesh-core -p '{"spec": {"type": "NodePort"}}'
```

#### 2. Used Minikube Service Tunnel
Created a stable tunnel using minikube's built-in service command:
```bash
minikube service agent-mesh-solace-agent-mesh-core --url
```

This provides stable localhost URLs that map to the NodePort service.

#### 3. Updated SAM_URL Configuration
Changed `.env.local`:
```diff
-SAM_URL=http://localhost:8000
+SAM_URL=http://127.0.0.1:64737
```
(Port 64737 is the tunnel port for SAM webui/API - this changes on each tunnel restart)

#### 4. Fixed Agent Name
Corrected the target agent name in `src/app/api/chat/route.ts`:
```diff
-const TARGET_AGENT = "Orchestrator";
+const TARGET_AGENT = "OrchestratorAgent";
```

The actual agent registered in SAM is named `OrchestratorAgent`, not `Orchestrator`.

### Files Changed
- `.env.local` - Updated SAM_URL to use minikube tunnel
- `src/app/api/chat/route.ts` - Fixed agent name to "OrchestratorAgent"

### Verification
1. SAM API responds correctly via tunnel
2. Dashboard chat receives and displays SAM responses
3. SSE streaming works without timeouts

### Notes
- The minikube tunnel terminal must remain open
- Tunnel ports are dynamic - update `.env.local` if ports change after restart
- Use `/docs` endpoint to view SAM API documentation
- Use `/api/v1/agentCards` to verify available agent names
