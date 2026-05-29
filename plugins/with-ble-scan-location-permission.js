const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const BLUETOOTH_SCAN_PERMISSION = 'android.permission.BLUETOOTH_SCAN';
const USES_PERMISSION_FLAGS_ATTRIBUTE = 'android:usesPermissionFlags';

function appendToolsRemove(existingValue, attribute) {
  const values = new Set(
    String(existingValue ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add(attribute);
  return Array.from(values).join(',');
}

module.exports = function withBleScanLocationPermission(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const androidManifest = manifestConfig.modResults;
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);

    const permissions = androidManifest.manifest['uses-permission'] ?? [];
    androidManifest.manifest['uses-permission'] = permissions;

    let scanPermission = permissions.find(
      (permission) => permission.$?.['android:name'] === BLUETOOTH_SCAN_PERMISSION,
    );

    if (scanPermission == null) {
      scanPermission = { $: { 'android:name': BLUETOOTH_SCAN_PERMISSION } };
      permissions.push(scanPermission);
    }

    scanPermission.$ = scanPermission.$ ?? {};
    scanPermission.$['android:name'] = BLUETOOTH_SCAN_PERMISSION;
    scanPermission.$['tools:targetApi'] = '31';
    scanPermission.$['tools:remove'] = appendToolsRemove(
      scanPermission.$['tools:remove'],
      USES_PERMISSION_FLAGS_ATTRIBUTE,
    );
    delete scanPermission.$[USES_PERMISSION_FLAGS_ATTRIBUTE];

    return manifestConfig;
  });
};
