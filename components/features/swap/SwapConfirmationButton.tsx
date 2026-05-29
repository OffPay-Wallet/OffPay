import { GlassSliderButton } from '@/components/ui/glass-slider-button';

interface SwapConfirmationButtonProps {
  onPress: () => void;
  disabled?: boolean;
  label?: string;
  feedbackLabel?: string | null;
  feedbackTone?: 'default' | 'danger';
  holdOnComplete?: boolean;
  resetSignal?: string | number | boolean | null;
}

export function SwapConfirmationButton({
  onPress,
  disabled = false,
  label = 'Review Swap',
  feedbackLabel = null,
  feedbackTone = 'default',
  holdOnComplete = false,
  resetSignal = null,
}: SwapConfirmationButtonProps): React.JSX.Element {
  const loading = label.toLowerCase().includes('submitting');
  const privateSwap = label.toLowerCase().includes('private');
  const sliderLabel =
    feedbackLabel ??
    (label === 'Refresh Quote'
      ? 'Slide to refresh quote'
      : privateSwap
        ? 'Slide to review private swap'
        : 'Slide to review swap');

  return (
    <GlassSliderButton
      label={sliderLabel}
      loadingLabel={label}
      disabled={disabled}
      loading={loading}
      feedbackTone={feedbackTone}
      holdOnComplete={holdOnComplete}
      resetSignal={resetSignal}
      onComplete={onPress}
    />
  );
}
