# Runbooks

Operational and workflow guides. Application source remains under `web-app/`; host scripts under `ops/`.

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT_WORKFLOW.md](./DEPLOYMENT_WORKFLOW.md) | **Current** promote pipeline Dev → Staging → Production (no env branches) |
| [SERVER_SETUP_GUIDE.md](./SERVER_SETUP_GUIDE.md) | Host / Docker setup notes |
| [REDUNDANCY_SETUP.md](./REDUNDANCY_SETUP.md) | Primary / backup replication (59 ↔ 118) |
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | Testing notes (verify ports against current matrix) |
| [WORKFLOW.md](./WORKFLOW.md) | **Legacy** branch/port notes — superseded by DEPLOYMENT_WORKFLOW.md |

Related: [`../../ops/README.md`](../../ops/README.md) · [`../architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md`](../architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md).

Environment matrix: **59:9090** (dev/test) · **59:8080** (staging) · **118:8080** (production).
