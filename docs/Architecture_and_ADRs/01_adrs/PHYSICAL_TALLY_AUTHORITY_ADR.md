# ADR — Physical Tally Authority (DC Dispatch + Retire)

**Status:** Accepted as owner direction (2026-09-28). **Implementation:** Phases 1–4 (incl. read-only Stock Tally report) landed on local 8080 (2026-09-28; migration `20260928120000_asset_retire_lifecycle.js`; overrides in `services/manualOverrideService.js`) — see §7. Not yet on production.  
**Date:** 2026-09-28  
**Deciders:** AssetEngine product / engineering  
**Amends:** [PURCHASE_BOOK_AND_DC_ADR.md](./PURCHASE_BOOK_AND_DC_ADR.md) §5.2 (Mode B pool exclusions)  
**Builds on:** [DC_DISPATCH_DISPOSITION_ADR.md](./DC_DISPATCH_DISPOSITION_ADR.md), [DC_RETURN_INWARD_LIFECYCLE_ADR.md](./DC_RETURN_INWARD_LIFECYCLE_ADR.md), [POST_COMMIT_COMMERCIAL_RECONCILIATION_ADR.md](./POST_COMMIT_COMMERCIAL_RECONCILIATION_ADR.md)

## Context

The on-hand tally (how many Assets / how much Inventory Cineom physically holds and owns) was drifting between several mechanisms:

- **Purchase Books** were considered the tally anchor, but only procurement-born stock ever has a Purchase Book. Stock registered through **Physical Intake** never does, so a book-based tally can never be complete.
- The DC holdings search (Mode B) **excluded** Receipt-Note-born and PO-linked holdings, so procurement stock could only leave through a PO-linked DC — a Demo or Repair of a purchased asset had no ordinary path.
- Several edit paths change counts or out-states **without** any outbound document:
  - Asset edit form and the Assets table inline Status editor can set `Sold`, `Scraped`, `Retired`, `Demo`, `Rental`, `In-Repair` directly.
  - Asset edit can change `quantity_total`.
  - Inventory edit (`PUT /api/inventory/items/:id`) can overwrite `quantity_total` / `quantity_available`.
  - Manual inventory movements (`POST /api/inventory/movements`).
- There is no controlled **Retire** action: retirement is only a status flip in the edit form.

## Decision

### 1. The tally rule

Physical stock enters AssetEngine through **Receipt Note** (procurement or Return Inward) or **Physical Intake**. It leaves, or changes out-state, through exactly four controlled exits:

| Exit | Document / action | Effect |
|------|-------------------|--------|
| **DC dispatch** | Delivery Challan with Dispatch Reason | DEMO / RENTAL / REPAIR → temporarily out, still owned (returns via Return Inward RN). SALE → ownership exit. Unchanged from [DC_DISPATCH_DISPOSITION_ADR.md](./DC_DISPATCH_DISPOSITION_ADR.md). |
| **Retire** | Asset Retire action (new, §4) | Permanent exit, not sold: Scrapped / Lost / Damaged beyond repair / Written off. |
| **Vendor Return** | Vendor Return dispatch | Goods returned to supplier. Stays its own controlled exit per [POST_COMMIT_COMMERCIAL_RECONCILIATION_ADR.md](./POST_COMMIT_COMMERCIAL_RECONCILIATION_ADR.md). |
| **Inventory Consume** | `POST /api/inventory/movements` (`CONSUME`) | Inventory used up internally, not dispatched. Any role with `inventory.adjust`; written reason mandatory (owner decision 2026-09-28). |

Everything else that changes a count or out-state is either a **reshaping** of stock that stays on hand (§6) or a **superuser override** (§5).

### 2. Purchase Books are not the tally

Purchase Books remain the commercial / invoice layer and keep their physical and serial allocation (`purchase_book_physical`) and DC quantity lock. They **never** change on-hand quantity and are **not** the source of truth for the tally.

### 3. Any in-store holding is DC-able, whatever its origin

The Mode B pool exclusions in [PURCHASE_BOOK_AND_DC_ADR.md](./PURCHASE_BOOK_AND_DC_ADR.md) §5.2 are **withdrawn**.

- Eligible for a DC: any non-deleted holding with available quantity that is not sold, retired, already out on Demo / Rental / Repair, or reserved by another owner. This applies whether it came from Physical Intake, a Receipt Note, is PO-linked, or is Awaiting PO.
- PO and Purchase Book become **optional references** on the DC, not gates.
- The DC picker shows each holding's origin (Physical Intake / Receipt Note / PO-linked / Awaiting PO) so the operator can see the commercial context.
- Physical availability is guarded by the existing primitives — READY reservation (`owner_type = DC`) and dispatch disposition status — not by pool membership.
- When a holding that has a `purchase_book_physical` link is added to a DC without selecting the book, the DC line **records that book link** so the book's remaining DC-able quantity stays coherent. It does not block the DC.

### 4. Asset Retire action

- A dedicated action with a mandatory reason: `SCRAPPED | LOST | DAMAGED_BEYOND_REPAIR | WRITTEN_OFF`, plus an optional note.
- Refused when the asset is reserved, on an open DC (DRAFT / READY), out on Demo / Rental / Repair, part of a Set, already sold / retired, or closed (lineage `INACTIVE` after a Break merge or a reclassify to inventory; `ASSET_INACTIVE`, added 2026-09-29).
- Result: `is_retired = 1`, status `Retired`, who / when / reason recorded, the asset's serial notations retired, and an `asset_history` + audit event written.
- Gated by a new action permission `asset.retire` (RBAC V2), granted to superuser and admin by default.
- Inventory write-off is **out of scope** for this ADR (owner decision 2026-09-28).

### 5. Direct edits become superuser overrides

These changes are refused for everyone except **superuser**, and a superuser must give a written reason, stored as a `MANUAL_OVERRIDE` history event:

- Asset Status set to `Sold`, `Scraped`, or `Retired` (use DC SALE or Retire instead).
- Asset Status set to `Demo`, `Rental`, or `In-Repair` (these out-states must come from a DC).
- Asset Status moved **away from** any of the above by direct edit (the return path is Return Inward / release-to-store, not a status flip).
- Asset `quantity_total` change, or turning quantity tracking off on a tracked asset.
- Inventory `quantity_total` / `quantity_available` change through item edit.
- Manual inventory movements other than `CONSUME` (none are enabled today).
- The legacy direct-sale endpoint `POST /api/assets/:id/sell`.

Non-superusers get a clear message pointing to DC or Retire. The frontend hides these options for non-superusers and prompts a superuser for the reason; the **backend** check is authoritative.

Implementation notes: the server answers `403 MANUAL_OVERRIDE_SUPERUSER_ONLY` or `400 MANUAL_OVERRIDE_REASON_REQUIRED`; the client retries once with `overrideReason`. Asset overrides write an `asset_history` `MANUAL_OVERRIDE` row plus a WARN audit entry; inventory overrides put the reason in the `inventory_quantity_events` note / metadata plus a WARN audit entry. Ordinary edits (name, location, In Store ↔ Project / Stand By / In-Use, unchanged quantity) are unaffected.

Inventory soft delete / restore is unchanged (restorable, not an exit).

### 6. Reshaping is not an exit

Split, Break, Unsplit and Asset ↔ Inventory Conversion move stock between identities that remain on hand. They keep their existing quantity-lineage rules and are not tally exits.

## Rejected alternatives

- Using Purchase Books as the tally anchor — cannot cover Physical Intake stock.
- Keeping the procurement exclusion on Mode B — blocks legitimate Demo / Rental / Repair of purchased stock.
- Routing Vendor Return through a DC reason — it already has its own controlled lifecycle.
- Removing direct edits entirely — superuser still needs a corrective path for data errors.
- Letting non-superusers set out-states manually — breaks DC as the authority for "where is it".

## Consequences

- Every drop in on-hand quantity traces to a DC dispatch, a Retire, a Vendor Return dispatch, or a reasoned superuser override.
- Legacy `LEGACY_UNSPECIFIED` DCs and assets already carrying manual `Demo` / `Rental` / `In-Repair` / `Sold` / `Scraped` statuses are **not** rewritten. They remain as historical state; new changes follow this ADR.
- Operators lose the ability to "just set Sold" from the edit form; they create a DC with SALE instead.

## 7. Implementation phases

Each phase is independent and verified on local 8080 and a scratch DB before any production rollout.

1. **DC accepts any origin** — relax `/api/dc/holdings-search` and any matching `POST /api/dc` check; origin badge in the DC picker; auto-record book link (§3). No schema change.
2. **Asset Retire** — `POST /api/assets/:id/retire`, Retire UI with reason; migration for the `asset.retire` permission and retirement columns if none exist.
3. **Superuser overrides** — enforce §5 on `PUT /api/assets/:id`, `PUT /api/inventory/items/:id`, `POST /api/inventory/movements`; edit form and inline Status editor honour it.
4. **Stock Tally report (read-only)** — Logistics → Stock Tally (`tally-view`), `GET /api/reports/tally` and `GET /api/reports/tally/:productId` (`__none__` = holdings without a Product), gated by `dashboard.view`. No schema change. Service: `services/tallyReportService.js`.

### Stock Tally rules

Per Product, assets and inventory combined:

- **In** = posted Receipt Note physical output (excluding `RETURN_INWARD`) + Physical Intake output + **Opening** (legacy holdings with no RN/PI/conversion origin; counted at current on hand + exits + deleted + converted-out).
- **Exits** = DC SALE, **Other DC exit** (DC REPLACEMENT / FOC), Asset Retire, Vendor Return (Vendor Return document DISPATCHED, or DC VENDOR_RETURN), Inventory Consume, other terminal statuses (Sold / Lost / Scrapped set directly).
- **Out on DC** = Demo / Rental / Repair / Internal Use / Stock Transfer dispatched and not yet returned — still owned, shown for information, not subtracted.
- **Out · manual status** = holdings whose status is an out-state (Demo / Rental / Repair / Internal Use / In Transit, plus any returnable catalog reason's status) with no open DC behind them — typically a superuser override. Informational follow-up flag only: not subtracted, not part of the mismatch. Resolve by raising a DC or correcting the status.
- **Expected on hand** = In − Exits − Deleted. **Mismatch** = actual on hand − expected. Manual `ADJUST` quantity events (non-reversal) on non-legacy holdings are listed alongside so a mismatch can be explained.
- Drill-down lists each holding with the RN / PI / DC / Vendor Return documents behind its numbers.
- **Type filter** (All / Assets / Inventory, `?type=ASSET|INVENTORY`). To keep a single type balanced, Inventory→Asset conversion is shown as **Converted**: live converted assets (`conversion_source_id`) count as converted in; the source inventory's outstanding `quantity_converted` counts as converted out. The two cancel in the All view.

## 8. DC dispatch reasons and their tally effect

Migration `20260928160000_dc_extended_dispatch_reasons.js` widens the reason / disposition / return-reason checks and adds `delivery_challans.transfer_destination`.

| Reason | Kind | Asset status on dispatch | Disposition | Tally | Closed by |
|--------|------|--------------------------|-------------|-------|-----------|
| DEMO / RENTAL / REPAIR | Returnable | Out on Demo / Out on Rental / Out for Repair | OUT_ON_* / OUT_FOR_REPAIR | Out on DC | Return Inward |
| INTERNAL_USE | Returnable | Out for Internal Use | OUT_FOR_INTERNAL_USE | Out on DC | Return Inward (`INTERNAL_USE_COMPLETED`) |
| STOCK_TRANSFER | Returnable | In Transit | IN_TRANSIT | Out on DC | Return Inward (`TRANSFER_RECEIVED`) at destination |
| SALE | Exit | Sold | SOLD | Out · DC Sale | — |
| REPLACEMENT | Exit | Replaced | REPLACED | Out · Other DC exit | — (defective unit comes back via Return Inward on its own DC) |
| FOC | Exit | Issued FOC | ISSUED_FOC | Out · Other DC exit | — |
| VENDOR_RETURN | Exit | Returned to Vendor | RETURNED_TO_VENDOR | Out · Vendor Rtn | — |

- Exits follow the SALE path: asset `is_retired = 1` (+ `sale_details.exitReason`); inventory total/available reduced with a `DC_<REASON>_EXIT` quantity event.
- **Stock Transfer** requires a destination (on create / READY; checked again at dispatch). On posting the Return Inward, assets move: `previouslocation` ← current, `currentlocation` ← destination. Inventory moves only when the whole item was transferred and fully received; a partial-quantity transfer leaves the location unchanged (a split would be needed) and records `locationMove.skipped` on the DC RETURNED event.
- New statuses are controlled (superuser override only) and block Asset Retire while out.

## 9. Configurable dispatch reasons (catalog)

Migration `20260928180000_dc_dispatch_reason_catalog.js` moves the reason list from code into the `dc_dispatch_reason` table (seeded with the nine reasons in §8 plus the inactive `LEGACY_UNSPECIFIED`). The old `CHECK (dispatch_reason IN …)` constraints on `delivery_challans` and `dc_disposition_line` are replaced by foreign keys to the catalog; the disposition-status check becomes a format check.

- **Who:** permission `dc.reason.manage` (high risk), granted to superuser and admin; grantable to other roles via RBAC. UI: Settings → DC Dispatch Reasons.
- **What a reason is:** label, code (derived from the label, immutable), asset status set on dispatch, sort order, active flag, and one fixed **behaviour**:

| Behaviour | Dispatch | Return Inward | Tally column |
|-----------|----------|---------------|--------------|
| RETURNABLE | Asset → reason's status; inventory stays reserved | Yes | Out on DC |
| RETURNABLE_DESTINATION | Same, and the DC must carry a destination | Yes; assets move to the destination | Out on DC |
| SALE_EXIT | Asset exits (`is_retired`); inventory reduced | No | Out · DC Sale |
| OTHER_EXIT | Same as sale exit | No | Out · Other DC exit |
| VENDOR_EXIT | Same as sale exit | No | Out · Vendor Rtn |

- **Locks:** behaviour and asset status are frozen once any DC (draft or dispatched) uses the reason; label, order and active flag stay editable. Built-in reasons never change behaviour or asset status. Reasons are never deleted; deactivating hides them from the DC form while old DCs still resolve them. Asset statuses that are normal in-store states (In Store, Under Inspection, In-Use, …) are refused.
- **Derived rules:** every reason's asset status becomes a controlled status (superuser override only); returnable reasons' statuses block Asset Retire. Dispatch, Return Inward and the Stock Tally read the behaviour from the catalog (30 s cache, reloaded on every change), so a new reason needs no code change.
- **Return reasons** stay a fixed list in this phase.
- Custom disposition statuses are `OUT_<CODE>` (returnable) or `EXIT_<CODE>` (exit); inventory exits write `DC_<CODE>_EXIT` quantity events.
- Verification: `scripts/dc-reason-catalog-verify.js` (rolled back).

## 10. Sets are product recipes; units are picked on the DC

- **A Set is only a recipe:** `set_requirement` (Product × quantity). Zoho receives the commercial product (name + frozen description) and never learns which physical unit was used.
- **Set allocation is retired.** `POST /api/sets/:id/allocations` and `.../replace` answer 410 `SET_ALLOCATION_RETIRED`; releasing an earlier allocation (`DELETE`) still works. The existing Konvision allocations were released on 2026-09-29 (local 8080, after a backup).
- **DC → ＋ Add Set:** `GET /api/dc/sets` and `GET /api/dc/sets/:setId/pick-options?kits=N` (`dc.create`) list eligible in-store holdings per component (same eligibility as holdings search). Serial assets, quantity assets and inventory can all be picked.
- **Draft create validates** Set lines (`dcSetService.prepareSetItems`, inside the DC transaction): every component must be exactly `quantity × kits` (short kits are blocked, `SET_INCOMPLETE`); the holding must be that component's Product; one holding may appear only once per DC.
- **Auto-break:** a DC Asset line always moves the whole record, so picking fewer units than a quantity Asset holds splits it with Break first and the DC line points at the new child. The split stays even if the draft is later voided.
- **Print:** each kit prints as one line: the Set name, the Set description, qty = kits, unit SET, and the summed amount. Component units are still picked and leave stock behind that line ([SET_COMMERCIAL_DEFINITION_ADR.md](./SET_COMMERCIAL_DEFINITION_ADR.md) §5).

## 11. Reclassify an Asset as Inventory

- **Who / why:** superuser only (`RECLASSIFY_SUPERUSER_ONLY`), with a written reason of at least 10 characters. For records booked as the wrong type (e.g. a consumable cable taken in as an asset). Not a stock movement: nothing enters or leaves the business.
- **API:** `GET /api/assets/:id/reclassify-to-inventory` (blockers, eligible targets, inventory kinds) and `POST` with `target = NEW` (+ `kindId`) or `EXISTING` (+ `inventoryId`). UI: "Reclassify as Inventory" beside Retire on the asset edit screen.
- **Strict eligibility:** in store (not out on DC / sold / retired / inactive / deleted), has a Product, not a Set, no active reservation, no Set allocation, not on a DRAFT/READY DC, no active Break children, whole quantity free. The whole record moves; to move part of it, Break first.
- **Target:** a new inventory item (copies name, Product, location, unit; folder and kind from the chosen inventory Kind; encrypted serial copied) or an existing active, in-store, quantity-tracked item of the same Product and unit (its root `quantity_original` grows with it).
- **Record:** one transaction writes a `conversion` row (`status = RECLASSIFIED`, `reason_code = RECLASSIFY_NEW | RECLASSIFY_EXISTING`, reason, actor), SOURCE/DESTINATION `conversion_line`s, a `RECLASSIFY_ASSET_TO_INVENTORY` event, `RECLASSIFY_OUT` / `RECLASSIFY_IN` quantity events, and an asset history entry. The asset becomes `lineage_status = INACTIVE` with `quantity_converted` = moved quantity (conservation holds). Active `serial_identity` rows move to the inventory item. A new item carries `conversion_source_type = 'ASSET'`, `conversion_source_id`, `conversion_id`.
- **Tally:** the asset shows Converted out (on hand 0), the inventory item Converted in; a new item is labelled "Reclassified from asset", never opening stock. Product totals are unchanged.
- **No undo button:** going back is the normal Inventory → Asset conversion (new asset ID, its own record).
- Migration `20260929120000_asset_reclassify_to_inventory` (additive). Verification: `scripts/asset-reclassify-verify.js` (rolled back).

## Decision log

| Date | Decision |
|------|----------|
| 2026-09-28 | Tally authority = DC dispatch + Retire (+ Vendor Return as its own exit); Purchase Books are not the tally |
| 2026-09-28 | Any in-store holding is DC-able regardless of origin; PO / Purchase Book optional |
| 2026-09-28 | Direct count / status edits kept as superuser-only overrides with mandatory reason |
| 2026-09-28 | Manual Demo / Rental / In-Repair status is superuser-only; out-states come from DC |
| 2026-09-28 | Asset Retire action in scope; Inventory write-off deferred |
| 2026-09-28 | Phase 3: leaving a controlled status and `/sell` also treated as superuser overrides |
| 2026-09-28 | Inventory CONSUME is a fourth controlled exit: `inventory.adjust` holders, mandatory reason (not superuser-only) |
| 2026-09-28 | Fixed DC SALE inventory dispatch writing `DC_SALE_EXIT` to non-existent columns (aborted the dispatch transaction) |
| 2026-09-28 | Stock Tally report: read-only, per Product, assets + inventory, reuses `dashboard.view`, no migration |
| 2026-09-28 | Stock Tally type filter (All / Assets / Inventory) with Converted in/out so a single type balances |
| 2026-09-28 | DC reasons added: Internal Use, Stock Transfer (returnable); Replacement, FOC, Return to Vendor (exits). Tally groups them into existing columns plus one "Other DC exit" column (§8) |
| 2026-09-28 | Stock Transfer destination recorded on the DC; assets move on receipt; inventory only when the whole item moved |
| 2026-09-28 | Dispatch reasons configurable via `dc_dispatch_reason` catalog (§9): fixed behaviours, `dc.reason.manage` for superuser + admin, behaviour/status locked once used, deactivate instead of delete; return reasons stay fixed |
| 2026-09-28 | Stock Tally "Out · manual status" column: out-state status without a DC is flagged for follow-up, never counted as Out on DC |
| 2026-09-29 | Sets = product recipe; units picked when the Set is added to a DC (§10). Set allocation retired (410), short kits blocked, partial pick of a quantity Asset auto-breaks it |
| 2026-09-29 | Asset → Inventory reclassification (§11): superuser only, reason ≥ 10 chars, whole record, new item or existing same-Product item, recorded as a RECLASSIFIED conversion; serials move with the unit |
