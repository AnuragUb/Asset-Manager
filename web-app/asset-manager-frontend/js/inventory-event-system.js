/**
 * ESM adapter for the shared inventory event system (SSOT under web-app/shared/).
 * Loads the dual-mode script once, then re-exports helpers for inventory / history UI.
 */
import '/shared/inventoryEventSystem.js?v=7.08';

const sys = globalThis.InventoryEventSystem;
if (!sys) {
  throw new Error('InventoryEventSystem failed to load from /shared/inventoryEventSystem.js');
}

export const EVENT_TYPES = sys.EVENT_TYPES;
export const ENTITY_TYPES = sys.ENTITY_TYPES;
export const EVENT_DISPLAY_NAMES = sys.EVENT_DISPLAY_NAMES;
export const normalizeEventType = sys.normalizeEventType.bind(sys);
export const getEventDisplayName = sys.getEventDisplayName.bind(sys);
export const getEventUi = sys.getEventUi.bind(sys);
export const presentEvent = sys.presentEvent.bind(sys);

export default sys;
