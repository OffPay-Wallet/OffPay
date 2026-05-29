/**
 * Layout and behavior constants for the agentic chat surface.
 *
 * Hoisted into a separate module so they can be referenced by both the
 * screen and the dedicated chat components without dragging the whole
 * screen file into a unit test.
 */

export const HEADER_BUTTON_SIZE = 44;
export const PROMPT_HEIGHT = 56;
export const PROMPT_ICON_SIZE = 40;

/** Maximum recent message turns sent to the AI proxy per request. */
export const AGENT_HISTORY_LIMIT = 12;

/**
 * Number of prior user turns folded into the validator's `userText`. Lets
 * intent extraction see clarifications like "My own wallet" answered to the
 * agent's previous "tell me the recipient" prompt.
 */
export const AGENT_INTENT_PRIOR_TURNS = 3;

export const CHAT_DRAWER_MAX_WIDTH = 380;
