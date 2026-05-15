# Changelog

## 2026-05-15 - Topic Taxonomy & Transaction Data Fix

### Problem
Live transaction feed was showing:
- "Unknown Merchant" with $0.00 amounts
- Topics like `XX/unknown` instead of actual transaction topics
- Transactions appearing that didn't match the selected topic filter

### Root Cause
1. **Scored transactions overwriting original data**: When SAM returned scored results, the `undefined` values for `amount`, `merchant`, `type` were overwriting the original transaction data during object spread.
2. **Unfiltered scored responses**: The scored topic (`solace/fraud/v1/transactions/scored`) receives ALL scored transactions regardless of the raw subscription filter, causing non-matching transactions to appear.

### Solution

#### 1. Only Include Scoring Fields in Updates
Changed `scoredHandler` to only include fields that have actual values:
```typescript
// Before: included all fields (many were undefined)
const scoredUpdate = {
  amount: parsed.amount,       // undefined overwrites original!
  merchant: parsed.merchant,   // undefined overwrites original!
  ...
};

// After: only include scoring fields
const scoredUpdate = {
  transaction_id: parsed.transaction_id,
  risk_score: parsed.risk_score ?? 0,
  decision: parsed.decision ?? 'approved',
  agent_reasoning: parsed.reasoning || '',
};
// Optional fields added only if present
if (parsed.amount !== undefined) scoredUpdate.amount = parsed.amount;
```

#### 2. Ignore Unmatched Scored Transactions
Don't display scored transactions where we never received the raw transaction (due to topic filter):
```typescript
if (!originalTx) {
  console.log('[useSimulatorSAM] Ignoring scored tx - no matching raw:', txId);
  return prev;
}
```

#### 3. Store Full Transaction Data in Pending Map
Enhanced `pendingTxMapRef` to store full transaction data (not just timestamp) for retrieval when scored response arrives:
```typescript
pendingTxMapRef.current.set(tx.transaction_id, { 
  receivedAt: now, 
  tx: pendingTx  // Full transaction data
});
```

### Files Changed
- `src/hooks/useSimulatorSAM.ts` - Main fix for topic taxonomy
- `src/hooks/useSimulator.ts` - Alert type fix
- `src/app/page.tsx` - Alert key fix (alert_id)
- `src/components/charts/RiskDistributionChart.tsx` - Tooltip type fix
- `src/lib/simulator/service.ts` - SimulatorState return type
- `src/lib/solace/client.ts` - Solace event type fixes

### Verification
1. Select a topic filter (e.g., "Card Present" or "UK")
2. Only transactions matching that filter appear
3. All transactions show correct merchant name, amount, and topic

---

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
