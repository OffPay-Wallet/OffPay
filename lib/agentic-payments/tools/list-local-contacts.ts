import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

const MAX_CONTACTS_FOR_MODEL = 20;

export const listLocalContactsTool: AgenticToolDefinition = {
  name: 'list_local_contacts',
  schema: {
    name: 'list_local_contacts',
    description:
      'Lists saved local contact display names for recipient selection. Returns names only, never wallet addresses, mints, balances, or usage history.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    const contacts = context.knownWallets
      .filter((wallet) => wallet.source === 'contact')
      .map((contact) => ({ name: contact.name }))
      .filter((contact) => contact.name.trim().length > 0);

    if (contacts.length === 0) {
      return {
        result: {
          status: 'empty',
          count: 0,
          contacts: [],
          addressAvailableLocally: false,
        },
      };
    }

    return {
      result: {
        status: 'ok',
        count: contacts.length,
        contacts: contacts.slice(0, MAX_CONTACTS_FOR_MODEL),
        truncated: contacts.length > MAX_CONTACTS_FOR_MODEL,
        addressAvailableLocally: true,
      },
    };
  },
};
