/**
 * Aggregator that re-exports the chat styles from the focused style modules
 * below. Kept thin so each themed file stays well under 400 lines and so a
 * component can either import this combined sheet or just the slice it
 * needs.
 */

export { headerStyles } from './styles/header';
export { messageStyles } from './styles/message';
export { confirmationStyles } from './styles/confirmation';
export { drawerStyles } from './styles/drawer';
export { promptStyles } from './styles/prompt';
