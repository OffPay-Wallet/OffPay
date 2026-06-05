import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffyFaucetGiftIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyFaucetGiftIcon({
  size = 24,
  color = colors.text.primary,
  focused = true,
}: PuffyFaucetGiftIconProps): React.JSX.Element {
  const fillOpacity = focused ? 0.95 : 0.76;

  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" color={color}>
      <Path
        d="M478.609 99.726H441.34c4.916-7.78 8.16-16.513 9.085-25.749C453.38 44.46 437.835 18 411.37 6.269c-24.326-10.783-51.663-6.375-71.348 11.479l-47.06 42.65C283.797 50.374 270.622 44.074 256 44.074c-14.648 0-27.844 6.32-37.011 16.375l-47.12-42.706C152.152-.111 124.826-4.502 100.511 6.275 74.053 18.007 58.505 44.476 61.469 73.992c.927 9.229 4.169 17.958 9.084 25.734H33.391C14.949 99.726 0 114.676 0 133.117v50.087c0 9.22 7.475 16.696 16.696 16.696h478.609c9.22 0 16.696-7.475 16.696-16.696v-50.087c-.001-18.441-14.95-33.391-33.392-33.391ZM205.913 94.161v5.565H127.37c-20.752 0-37.084-19.346-31.901-40.952 2.283-9.515 9.151-17.626 18.034-21.732 12.198-5.638 25.71-3.828 35.955 5.445l56.469 51.182c-.003.165-.014.327-.014.492Zm211.381-24.617c-1.244 17.353-16.919 30.184-34.316 30.184h-76.891v-5.565c0-.197-.012-.392-.014-.589 12.792-11.596 40.543-36.748 55.594-50.391 8.554-7.753 20.523-11.372 31.587-8.072 15.877 4.736 25.201 18.238 24.04 34.433Z"
        fill="currentColor"
        opacity={fillOpacity}
      />
      <Path
        d="M33.391 233.291v244.87c0 18.442 14.949 33.391 33.391 33.391h155.826V233.291H33.391Z"
        fill="currentColor"
        opacity={fillOpacity}
      />
      <Path
        d="M289.391 233.291v278.261h155.826c18.442 0 33.391-14.949 33.391-33.391v-244.87H289.391Z"
        fill="currentColor"
        opacity={fillOpacity}
      />
    </Svg>
  );
}
