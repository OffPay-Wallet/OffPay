import { GlassActionButton } from '@/components/ui/GlassActionButton';

import type { ReactNode } from 'react';
import type {
  GlassActionButtonSize,
  GlassActionButtonVariant,
} from '@/components/ui/GlassActionButton';

interface SecuritySetupButtonProps {
  label: string;
  onPress: () => void;
  variant?: GlassActionButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  size?: GlassActionButtonSize;
  accessibilityLabel?: string;
}

export function SecuritySetupButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  size = 'compact',
  accessibilityLabel,
}: SecuritySetupButtonProps): React.JSX.Element {
  return (
    <GlassActionButton
      label={label}
      onPress={onPress}
      variant={variant}
      disabled={disabled}
      loading={loading}
      icon={icon}
      size={size}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
