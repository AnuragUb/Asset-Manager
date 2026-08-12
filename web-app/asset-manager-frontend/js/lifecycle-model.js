/**
 * ESM adapter for the shared platform lifecycle model.
 */
import '/shared/lifecycleModel.js?v=7.09';

const sys = globalThis.LifecycleModel;
if (!sys) {
  throw new Error('LifecycleModel failed to load from /shared/lifecycleModel.js');
}

export const LIFECYCLE_STATES = sys.LIFECYCLE_STATES;
export const LIFECYCLE_DISPLAY_NAMES = sys.LIFECYCLE_DISPLAY_NAMES;
export const OPERATIONAL_STATUS = sys.OPERATIONAL_STATUS;
export const resolveLifecycle = sys.resolveLifecycle.bind(sys);
export const getLifecycleDisplayName = sys.getLifecycleDisplayName.bind(sys);
export const isConsumed = sys.isConsumed.bind(sys);
export const isDeleted = sys.isDeleted.bind(sys);
export const isRetired = sys.isRetired.bind(sys);
export const isActive = sys.isActive.bind(sys);
export const canTransition = sys.canTransition.bind(sys);
export const listLifecycleStates = sys.listLifecycleStates.bind(sys);

export default sys;
