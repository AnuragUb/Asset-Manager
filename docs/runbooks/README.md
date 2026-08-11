# Runbooks

Operational and workflow guides. Application source remains under `web-app/`; host scripts under `ops/`.

| Document | Purpose |
|----------|---------|
| [SERVER_SETUP_GUIDE.md](./SERVER_SETUP_GUIDE.md) | Host / Docker setup notes |
| [REDUNDANCY_SETUP.md](./REDUNDANCY_SETUP.md) | Primary / backup replication (59 ↔ 118) |
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | Testing notes (verify ports against current matrix) |
| [WORKFLOW.md](./WORKFLOW.md) | Branch / deploy workflow — **reconcile with GitHub reality before relying on it** |

Related: [`../../ops/README.md`](../../ops/README.md).

Environment matrix: **59:9090** (dev/test) · **59:8080** (staging) · **118:8080** (production).
