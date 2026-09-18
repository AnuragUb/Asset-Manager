# Architecture & ADRs — collection

Single folder for AssetEngine / CineEAM **architecture documents** and **Architecture Decision Records (ADRs)** gathered to date.

> Prefer this hub when looking for architecture or ADR material.  
> Numbered handbook chapter [`../02_ARCHITECTURE.md`](../02_ARCHITECTURE.md) remains in place for the `01`–`10` doc series (a copy also lives under `00_handbook/`).  
> Domain lifecycle truth remains [`../../PROCESS_LOGIC.md`](../../PROCESS_LOGIC.md).

---

## Layout

| Subfolder | Contents |
|-----------|----------|
| [`00_handbook/`](./00_handbook/) | Handbook architecture chapter (copy of `02_ARCHITECTURE.md`) |
| [`01_adrs/`](./01_adrs/) | ADRs and explicit architecture decisions |
| [`02_domain_architecture/`](./02_domain_architecture/) | Domain / platform architecture (lifecycle, inventory events, Zoho CRM, sets, recovery, releases, …) |
| [`03_audits_and_research/`](./03_audits_and_research/) | Architecture audits, gap analyses, research reports |
| [`04_historical/`](./04_historical/) | Older / archived architecture notes (not live source of truth) |

---

## 01 — ADRs & decisions

| Doc | Topic |
|-----|--------|
| [FRONTEND_REACT_ADR.md](./01_adrs/FRONTEND_REACT_ADR.md) | Vanilla SPA now; React deferred; Express stays |
| [LIFECYCLE_SOURCED_ADOPTED_ADR.md](./01_adrs/LIFECYCLE_SOURCED_ADOPTED_ADR.md) | Sourced vs Adopted lifecycles; Awaiting Adoption |
| [PRODUCT_ARCHITECTURE_DECISION.md](./01_adrs/PRODUCT_ARCHITECTURE_DECISION.md) | Product architecture decision |
| [PURCHASE_BOOK_AND_DC_ADR.md](./01_adrs/PURCHASE_BOOK_AND_DC_ADR.md) | Purchase Book (multi-invoice per PO) + dual-mode DC; presentation vs identity |
| [SERIAL_IDENTITY_ADR.md](./01_adrs/SERIAL_IDENTITY_ADR.md) | First-class manufacturer serial rows (`serial_identity`) |

---

## 02 — Domain architecture

| Doc | Topic |
|-----|--------|
| [LIFECYCLE_MODEL.md](./02_domain_architecture/LIFECYCLE_MODEL.md) | Platform lifecycle model |
| [MANAGED_SETS_ARCHITECTURE.md](./02_domain_architecture/MANAGED_SETS_ARCHITECTURE.md) | Managed Sets / Kits |
| [inventory-event-system.md](./02_domain_architecture/inventory-event-system.md) | Inventory audit events |
| [EVENT_SYSTEM_GUIDE.md](./02_domain_architecture/EVENT_SYSTEM_GUIDE.md) | Event system developer guide |
| [INVENTORY_MOVEMENT_SYSTEM.md](./02_domain_architecture/INVENTORY_MOVEMENT_SYSTEM.md) | Inventory movement (CONSUME) |
| [ZOHO_CRM_INTEGRATION.md](./02_domain_architecture/ZOHO_CRM_INTEGRATION.md) | Zoho CRM OAuth + sync |
| [RECOVERY_CENTER.md](./02_domain_architecture/RECOVERY_CENTER.md) | Soft-delete recovery |
| [RELEASE_MANAGEMENT.md](./02_domain_architecture/RELEASE_MANAGEMENT.md) | SemVer / manifests / matrix |
| [DEPLOYMENT_ENVIRONMENT_REPORT.md](./02_domain_architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md) | Environments & readiness |
| [SPRINT_1_RETROSPECTIVE.md](./02_domain_architecture/SPRINT_1_RETROSPECTIVE.md) | Sprint 1 retrospective |

---

## 03 — Audits & research

| Doc | Topic |
|-----|--------|
| [ASSETENGINE_CANONICAL_ARCHITECTURE.md](./03_audits_and_research/ASSETENGINE_CANONICAL_ARCHITECTURE.md) | Canonical architecture |
| [ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md](./03_audits_and_research/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md) | Complete architecture audit |
| [ASSETENGINE_MASTER_READINESS_AUDIT.md](./03_audits_and_research/ASSETENGINE_MASTER_READINESS_AUDIT.md) | Master readiness audit |
| [ARCHITECTURE_GAP_ANALYSIS.md](./03_audits_and_research/ARCHITECTURE_GAP_ANALYSIS.md) | Gap analysis |
| [ASSET_INVENTORY_SET_ARCHITECTURE_RESEARCH.md](./03_audits_and_research/ASSET_INVENTORY_SET_ARCHITECTURE_RESEARCH.md) | Asset / inventory / set research |
| [SET_ARCHITECTURE_AUDIT.md](./03_audits_and_research/SET_ARCHITECTURE_AUDIT.md) | Set architecture audit |
| [ZOHO_BOOKS_INTEGRATION_ARCHITECTURE_RESEARCH.md](./03_audits_and_research/ZOHO_BOOKS_INTEGRATION_ARCHITECTURE_RESEARCH.md) | Zoho Books integration research |
| [ZOHO_PRODUCT_AE_SYNC_AUDIT.md](./03_audits_and_research/ZOHO_PRODUCT_AE_SYNC_AUDIT.md) | Zoho Product ↔ AE sync audit |
| [PRODUCT_INTEGRATION_AUDIT.md](./03_audits_and_research/PRODUCT_INTEGRATION_AUDIT.md) | Product integration audit |
| [PRODUCTION_AUDIT.md](./03_audits_and_research/PRODUCTION_AUDIT.md) | Production audit |

---

## 04 — Historical (not source of truth)

| Doc | Topic |
|-----|--------|
| [ARCHITECTURE_OVERVIEW.md](./04_historical/ARCHITECTURE_OVERVIEW.md) | Older overview |
| [ARCHITECTURE_PROPOSAL.md](./04_historical/ARCHITECTURE_PROPOSAL.md) | Older proposal |
| [system-architecture.md](./04_historical/system-architecture.md) | Legacy system architecture note |
| [DATABASE_AUDIT_9090.md](./04_historical/DATABASE_AUDIT_9090.md) | Historical DB audit |

These are also still under [`../archive/`](../archive/) where applicable.

---

## Related (not moved here)

| Doc | Why left in place |
|-----|-------------------|
| [`../02_ARCHITECTURE.md`](../02_ARCHITECTURE.md) | Handbook `01`–`10` series |
| [`../../PROCESS_LOGIC.md`](../../PROCESS_LOGIC.md) | Lifecycle / quantity domain truth |
| [`../01_PROJECT_OVERVIEW.md`](../01_PROJECT_OVERVIEW.md) … [`../10_NEXT_PHASE.md`](../10_NEXT_PHASE.md) | Product handbook |
| [`../runbooks/`](../runbooks/) | Ops runbooks |

---

## Environments

**59:9090** (dev/test) · **59:8080** (staging) · **118:8080** (production).
