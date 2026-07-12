import { StyleSheet } from 'react-native';

import { payrollStyles } from '@/components/features/payroll/styles';

import { isCompactChatCardLayout } from '../constants';
import { confirmationStyles } from '../styles/confirmation';
import { messageStyles } from '../styles/message';

describe('agent message layout', () => {
  it('gives every action and tool card a definite available width', () => {
    expect(StyleSheet.flatten(messageStyles.agentMessageStack)).toMatchObject({
      flex: 1,
      minWidth: 0,
      alignItems: 'flex-start',
    });
    expect(StyleSheet.flatten(messageStyles.actionCardWrap)).toMatchObject({
      width: '100%',
      minWidth: 0,
    });
    expect(StyleSheet.flatten(messageStyles.toolCardWrap)).toMatchObject({
      width: '100%',
      minWidth: 0,
    });
    expect(StyleSheet.flatten(messageStyles.messageRowAgentCard)).toMatchObject({
      paddingRight: 0,
    });
    expect(StyleSheet.flatten(confirmationStyles.confirmationCard)).toMatchObject({
      width: '100%',
      minWidth: 0,
    });
    expect(StyleSheet.flatten(confirmationStyles.confirmationRowCompact)).toMatchObject({
      flexDirection: 'column',
      alignItems: 'stretch',
    });
    expect(StyleSheet.flatten(confirmationStyles.confirmationActions)).toMatchObject({
      flexWrap: 'wrap',
    });
    expect(StyleSheet.flatten(payrollStyles.card)).toMatchObject({
      width: '100%',
      minWidth: 0,
    });
    expect(StyleSheet.flatten(payrollStyles.secondaryRow)).toMatchObject({
      flexWrap: 'wrap',
    });
  });

  it('uses the compact card layout on narrow screens and with enlarged text', () => {
    expect(isCompactChatCardLayout(320, 1)).toBe(true);
    expect(isCompactChatCardLayout(430, 1.2)).toBe(true);
    expect(isCompactChatCardLayout(430, 1)).toBe(false);
  });
});
