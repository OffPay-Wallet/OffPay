/**
 * Unlocks the panel's peak refresh rate on iOS (ProMotion 120 Hz) and
 * Android (60/90/120 Hz adaptive panels).
 *
 * iOS: `CADisableMinimumFrameDurationOnPhone` removes the legacy 60 Hz cap.
 * Android: `MainActivity` sets `preferredRefreshRate` from the active display
 * mode so React Native / Reanimated can schedule at the native refresh rate.
 */
const { withInfoPlist, withMainActivity } = require('@expo/config-plugins');

const REFRESH_RATE_MARKER = 'OffPayAdaptiveDisplayRefreshRate';

const ANDROID_REFRESH_BLOCK = `
    // ${REFRESH_RATE_MARKER}
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
      val defaultDisplay = windowManager.defaultDisplay
      if (defaultDisplay != null) {
        val refreshParams = window.attributes
        var peakRefreshRate = defaultDisplay.refreshRate
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
          val modes = defaultDisplay.supportedModes
          for (mode in modes) {
            if (mode.refreshRate > peakRefreshRate) {
              peakRefreshRate = mode.refreshRate
            }
          }
        }
        refreshParams.preferredRefreshRate = peakRefreshRate
        window.attributes = refreshParams
      }
    }
`;

function injectAndroidRefreshRate(mainActivity) {
  if (mainActivity.contents.includes(REFRESH_RATE_MARKER)) {
    return mainActivity;
  }

  // Handle Kotlin (no semicolon) or Java (with semicolon)
  const onCreateNeedle = /super\.onCreate\((?:null|savedInstanceState)\)[\s;]*/;
  if (!onCreateNeedle.test(mainActivity.contents)) {
    throw new Error(
      '[with-adaptive-display-refresh-rate] Could not locate MainActivity.onCreate to inject refresh-rate setup.',
    );
  }

  mainActivity.contents = mainActivity.contents.replace(
    onCreateNeedle,
    (match) => `${match}${ANDROID_REFRESH_BLOCK}`,
  );

  return mainActivity;
}

function withAdaptiveDisplayRefreshRate(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.CADisableMinimumFrameDurationOnPhone = true;
    return config;
  });

  config = withMainActivity(config, (config) => {
    config.modResults = injectAndroidRefreshRate(config.modResults);
    return config;
  });

  return config;
}

module.exports = withAdaptiveDisplayRefreshRate;
