# Asset Hierarchy Levels — Architecture Decision Record

**Status:** ACCEPTED  
**Date:** 23 October 2026  
**ID:** `ADR-ASSET-HIERARCHY-LEVELS-001`  
**Related:** Physical Intake folder path · `asset_folders` / `asset_kinds`

---

## 1. Problem

The Assets hierarchy mixed three different ideas in two tables:

- `asset_folders` (“top folders” and nested folders)
- `asset_kinds` (called Kind, Category, or Brand depending on the screen)

Operators could create a folder inside a category, a category with no folder, and nested kinds that disappeared after a parent was soft-deleted. There was no Make level, and the pane used the same folder icon for “create category”.

---

## 2. Decision

The Assets hierarchy has **three levels**. Names below are the product language.

| Level | Also called | Stored as | Parent may be | Icon |
|-------|-------------|-----------|---------------|------|
| **Folder** | Top folder, subfolder | `asset_folders` | None (top folder) or another **folder** | 📁 |
| **Category** | Categorization, sub-category | `asset_kinds.kind_role = CATEGORY` | **Folder**, **subfolder**, **category**, or **sub-category** | 📦 |
| **Make** | Brand / manufacturer node | `asset_kinds.kind_role = MAKE` | **Category** or **sub-category** only | ™ |

A **subfolder** is a folder whose parent is a folder. A **sub-category** is a category whose parent is a category. They are not extra types.

### Placement rules

1. A folder may be created at the top of a module, or **inside a folder**. Never inside a category or a make.
2. A category may be created **inside a folder or subfolder**, or **inside a category** (sub-category). Never inside a make. Never as a parentless top-level kind.
3. A make may be created **only inside a category or sub-category**. Never inside a folder.
4. **Inside a make, nothing is created:** no top folder, folder, category, or sub-category. Makes are leaves of the classification tree (assets still hang off the make as holdings).

### Operator surfaces

The hierarchy pane (sidebar tree) keeps two create actions and gains a third:

| Action | Where it is offered | Icon |
|--------|---------------------|------|
| Create folder | Empty pane / a folder | 📁 |
| Create category | A folder, subfolder, category, or sub-category | 📦 (box, not folder) |
| Create make | A category or sub-category only | ™ |

Right-click uses the same rules as the buttons. Create Make on a folder is not shown.

### Visual separation

- **Folder:** folder glyph, name only.
- **Category:** box glyph, name only.
- **Make:** name plus a **™** mark at the **top-right** of the tree row and of the dashboard card.

Existing category rows stay `CATEGORY`. New Makes are explicit. This ADR does **not** rewrite historical nested kinds into Makes.

---

## 3. Storage

- `asset_folders.parentid` — folder nesting (unchanged).
- `asset_kinds.id` — stable kind identity. Display name may repeat under a different parent.
- `asset_kinds.parentname` — parent **display name** (for paths).
- `asset_kinds.parent_id` — parent **folder id or kind id**. Live uniqueness is `(module, parent_id, name)`: the same category name may exist under two different top folders; not twice under the same parent.
- Holdings bind to `assets.folder_path` (full path), not to `type` name alone.
- `asset_kinds.kind_role` — `CATEGORY` \| `MAKE`, default `CATEGORY`.

Soft-delete of a category still hides that row. Live children under a deleted parent are shown on the nearest live folder/category ancestor (existing hoist). Folder delete still refuses while **live** descendants exist.

---

## 4. Non-goals (this phase)

- Inventory folders / inventory kinds (separate pane).
- Renaming `asset_kinds` table.
- Auto-converting old “brand” nested kinds into Makes.
- Renaming historical `type` values; path matching uses `folder_path` first.

---

## 5. Decision log

| Date | Decision |
|------|----------|
| 2026-10-23 | Three levels: Folder, Category, Make |
| 2026-10-23 | Make only under Category / Sub-category; nothing nests under Make |
| 2026-10-23 | Create-category icon is the box; Make uses ™ |
| 2026-10-23 | `kind_role` on `asset_kinds`; existing rows remain CATEGORY |
