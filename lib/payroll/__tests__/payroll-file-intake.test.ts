import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';

import { pickPayrollFile } from '@/lib/payroll/payroll-file-intake';
import { getAppLockSuppressionRemainingMs } from '@/lib/wallet/app-lock-suppression';

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn(),
}));

const getDocumentAsync = DocumentPicker.getDocumentAsync as jest.MockedFunction<
  typeof DocumentPicker.getDocumentAsync
>;

describe('pickPayrollFile', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-04T00:00:00.000Z'));
    getDocumentAsync.mockReset();
    (require('expo-file-system') as { __INTERNAL_RESET?: () => void }).__INTERNAL_RESET?.();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('suppresses app lock while the native picker is open', async () => {
    const file = new File('file:///cache/payroll.csv');
    file.create();
    file.write('recipient,amount\n9vSxWR4NTVuD8j7JxDU75JbRuwVB2Ht4zaXbgumr67CU,2\n');

    getDocumentAsync.mockImplementationOnce(async () => {
      expect(getAppLockSuppressionRemainingMs()).toBeGreaterThan(0);
      return {
        canceled: false,
        assets: [
          {
            name: 'payroll.csv',
            uri: file.uri,
            mimeType: 'text/csv',
            size: file.size,
            lastModified: 0,
          },
        ],
      };
    });

    const result = await pickPayrollFile();

    expect(result).toMatchObject({
      ok: true,
      cancelled: false,
      file: {
        fileName: 'payroll.csv',
        mimeType: 'text/csv',
      },
    });
    expect(getAppLockSuppressionRemainingMs()).toBeGreaterThan(0);

    jest.setSystemTime(new Date('2026-06-04T00:00:01.301Z'));
    expect(getAppLockSuppressionRemainingMs()).toBe(0);
  });
});
