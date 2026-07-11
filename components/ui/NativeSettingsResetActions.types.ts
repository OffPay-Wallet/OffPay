export interface NativeSettingsResetActionsProps {
  busy: boolean;
  cancelBackgroundColor: string;
  cancelBorderColor: string;
  cancelTextColor: string;
  confirmBackgroundColor: string;
  confirmTextColor: string;
  onCancel: () => void;
  onConfirm: () => void;
}
