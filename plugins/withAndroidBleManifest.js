const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const OPTIONAL_BLE_FEATURES = ['android.hardware.bluetooth', 'android.hardware.bluetooth_le'];

function upsertOptionalBleFeature(androidManifest, featureName) {
  if (!Array.isArray(androidManifest.manifest['uses-feature'])) {
    androidManifest.manifest['uses-feature'] = [];
  }

  const features = androidManifest.manifest['uses-feature'];
  const existingFeature = features.find((feature) => feature?.$?.['android:name'] === featureName);
  const attributes = {
    'android:name': featureName,
    'android:required': 'false',
    'tools:node': 'replace',
  };

  if (existingFeature) {
    existingFeature.$ = {
      ...existingFeature.$,
      ...attributes,
    };
    return;
  }

  features.push({ $: attributes });
}

function withAndroidBleManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    AndroidConfig.Manifest.ensureToolsAvailable(modConfig.modResults);

    for (const featureName of OPTIONAL_BLE_FEATURES) {
      upsertOptionalBleFeature(modConfig.modResults, featureName);
    }

    return modConfig;
  });
}

module.exports = withAndroidBleManifest;
