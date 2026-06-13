import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';

import {
  PAYROLL_EXPORT_GUIDANCE,
  PAYROLL_MAX_FILE_BYTES,
  resolvePayrollFormat,
} from '@/lib/payroll/parsing/payroll-formats';
import { beginAppLockSuppression } from '@/lib/wallet/app-lock-suppression';

export interface PayrollPickedFile {
  fileName: string;
  mimeType: string | null;
  text: string;
}

export type PayrollFilePickResult =
  | { ok: true; cancelled: false; file: PayrollPickedFile }
  | { ok: true; cancelled: true }
  | { ok: false; message: string };

const ACCEPTED_MIME_TYPES = [
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
  'application/json',
  'text/comma-separated-values',
  'application/csv',
  'application/x-csv',
  'text/x-csv',
  'application/vnd.ms-excel',
];

/**
 * Opens the system document picker, validates type + size, and reads the
 * file text. Heavy reads use the new `expo-file-system` `File` API. Returns a
 * cancelled result rather than throwing when the user dismisses the picker.
 *
 * Note: the actual parse is intentionally NOT done here — the caller stages
 * it through `stagePayroll`, which yields to the UI during parsing.
 */
export async function pickPayrollFile(): Promise<PayrollFilePickResult> {
  const releaseAppLockSuppression = beginAppLockSuppression();
  try {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_MIME_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      return { ok: false, message: 'Could not open the file picker. Try again.' };
    }

    if (picked.canceled) return { ok: true, cancelled: true };

    const asset = picked.assets?.[0];
    if (asset == null) return { ok: false, message: 'No file was selected.' };

    const fileName = asset.name?.trim() || 'batch-send';
    const mimeType = asset.mimeType ?? null;

    const format = resolvePayrollFormat(fileName, mimeType);
    if (!format.ok) {
      return { ok: false, message: format.message ?? PAYROLL_EXPORT_GUIDANCE };
    }

    // Prefer the picker-reported size; fall back to the File handle.
    const reportedSize = asset.size ?? null;
    if (reportedSize != null && reportedSize > PAYROLL_MAX_FILE_BYTES) {
      return { ok: false, message: 'This file is larger than the 2 MB batch send limit.' };
    }

    try {
      const file = new File(asset.uri);
      if (!file.exists) {
        return { ok: false, message: 'The selected file could not be read. Try uploading again.' };
      }
      if (file.size > PAYROLL_MAX_FILE_BYTES) {
        return { ok: false, message: 'This file is larger than the 2 MB batch send limit.' };
      }
      const text = await file.text();
      if (text.trim().length === 0) {
        return { ok: false, message: 'This file is empty.' };
      }
      return { ok: true, cancelled: false, file: { fileName, mimeType, text } };
    } catch {
      return {
        ok: false,
        message: 'The selected file could not be read. If it is in the cloud, download it first.',
      };
    }
  } finally {
    releaseAppLockSuppression();
  }
}
