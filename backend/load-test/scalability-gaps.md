# Scalability Gaps — Remaining Work

## Overview

The reservation system now has robust DB-layer resilience (semaphore, circuit breaker,
read/write pool separation, Redis caching). This document covers what still needs to
be addressed before the system can be considered "production-scalable."

---

## 1. Process-Level Resilience (Clustering)

### The Problem

The server runs as a **single Node.js process**. If it crashes — due to an unhandled
exception, OOM, or event-loop stall — every in-flight request fails with
`ECONNREFUSED` and the entire API goes dark until the process restarts.

The old ramp-to-failure test showed **419 `ECONNREFUSED`** + **3,527 `fetch failed`**
errors, confirming the process collapsed under peak load.

### Recommendation

Adopt **Node.js `cluster` mode** (or PM2) to fork one worker per logical CPU:

```
# package.json script
"start:prod": "node --max-old-space-size=4096 dist/main.js"
```

But with cluster:

```ts
import cluster from 'cluster';
import { cpus } from 'os';

if (cluster.isPrimary) {
  for (const cpu of cpus()) cluster.fork();
  cluster.on('exit', (worker) => cluster.fork()); // auto-heal
} else {
  bootstrap(); // NestFactory.create(...)
}
```

**Benefits:**
- A crash takes down 1 worker, not the whole service.
- Remaining workers absorb traffic while the dead worker respawns.
- Uses all CPU cores (single Node process uses only one).

---

## 2. Horizontal Scaling

### The Problem

A single box (even clustered) has finite RAM, CPU, and network bandwidth. To serve
thousands of concurrent users — or survive a regional cloud outage — you need
multiple machine instances behind a load balancer.

### Blockers

| Feature | Current | Required for Horizontal Scaling |
|---|---|---|
| **Session store** | Cookie-based JWTs (stateless) | ✅ Already stateless |
| **WebSocket state** | In-memory `Map<userId, Socket[]>` | ❌ Each client connects to one instance; broadcasts (hold-expiry) only reach sockets on that instance |
| **Cache** | Single Redis instance | ✅ Works across instances (shared Redis) |
| **DB pools** | Per-instance `Pool(max: 12/4)` | ✅ Each instance has its own pool; DB handles the total |

### Recommendation

1. **WebSocket gateway** (`screening.gateway.ts:47`): The in-memory `userSockets` map
   ties each user to one process. If that process restarts, the user's WebSocket
   connection drops. Consider:
   - **Short-term**: Add a health-check endpoint and rely on the client to reconnect
   - **Long-term**: Use Redis pub/sub for cross-instance broadcasts, or use
     Socket.IO's built-in Redis adapter

2. **Load balancer** (nginx / ELB / HAProxy): Place in front of the Node instances.
   Sticky sessions are NOT needed (JWTs are stateless), so round-robin works.

---

## 3. Validated Load Testing

### The Problem

The existing `ramp-to-failure.json` results are **invalid** because the IP rate
limiter blocked most virtual users at the login gate:

```
POST /auth/login → limit 5 requests per 15 min per IP
All VUs share one machine → all share one IP
After 5 logins, every subsequent login → 429
load-test/processor.js → throw new Error(...) on non-OK response
```

This means the test never actually stress-tested the reservation/screening/payment
endpoints for the majority of VUs.

### Recommendation

1. Set `LOGIN_RATE_LIMIT=5000` (or higher) in the `.env` before running load tests.
2. Re-run the ramp-to-failure scenario to get a meaningful baseline.
3. After implementing clustering, re-run the same test and compare:

   | Metric | Before Clustering | After Clustering |
   |---|---|---|
   | Max concurrent VUs before crash | ? | ? |
   | `ECONNREFUSED` count | 419 | 0 (expected) |
   | 503 rate at peak | ? | ? |
   | Steady-state throughput | ? | ? |

---

## 4. Monitoring & Observability

### The Problem

When the system breaks under load, there is no visibility into *why*:
- Are we CPU-bound, memory-bound, or I/O-bound?
- Is the event loop lagging?
- Are there unhandled promise rejections killing workers?

### Recommendation

Add at minimum:

- **`process.on('unhandledRejection')` / `process.on('uncaughtException')`**
  logger in `main.ts` — log the error before the process exits.
- **Event-loop lag monitoring** — `monitorEventLoopLag` (NestJS built-in) or
  a simple `setInterval` that checks `performance.now()` drift.
- **Health endpoint** — `GET /health` that returns `{ status: 'ok', uptime, ... }`
  for the load balancer to poll.

---

## Priority Order

```
1. Clustering (highest ROI — prevents total crash)
2. Re-run load tests with LOGIN_RATE_LIMIT fixed
3. Health endpoint + unhandled rejection logging
4. Multi-instance WebSocket strategy (if horizontal scaling is needed)
```
