import Svg, { Path } from 'react-native-svg';

export interface PuffyReceiveArrowIconProps {
  size?: number;
  color?: string;
}

export function PuffyReceiveArrowIcon({
  size = 24,
  color = '#00c7fc',
}: PuffyReceiveArrowIconProps): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fill={color}
        d="M12 2.75C12.9665 2.75 13.75 3.5335 13.75 4.5V13.4169L16.2626 10.9043C16.946 10.2209 18.054 10.2209 18.7374 10.9043C19.4209 11.5877 19.4209 12.6958 18.7374 13.3792L13.2374 18.8792C12.554 19.5626 11.446 19.5626 10.7626 18.8792L5.26256 13.3792C4.57915 12.6958 4.57915 11.5877 5.26256 10.9043C5.94598 10.2209 7.05402 10.2209 7.73744 10.9043L10.25 13.4169V4.5C10.25 3.5335 11.0335 2.75 12 2.75Z"
      />
      <Path
        fill={color}
        d="M5.75 19.25C4.7835 19.25 4 20.0335 4 21C4 21.9665 4.7835 22.75 5.75 22.75H18.25C19.2165 22.75 20 21.9665 20 21C20 20.0335 19.2165 19.25 18.25 19.25H5.75Z"
        opacity={0.82}
      />
    </Svg>
  );
}
