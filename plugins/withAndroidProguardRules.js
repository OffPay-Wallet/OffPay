const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const OFFPAY_ANDROID_PROGUARD_RULES = `
# munim-bluetooth is a Nitro/JSI module resolved by name from JavaScript.
# Release minification must keep its Kotlin entry points and generated bridge
# classes, otherwise Nitro cannot find com.munimbluetooth.HybridMunimBluetooth.
-keep class com.munimbluetooth.** { *; }
-keep class com.margelo.nitro.munimbluetooth.** { *; }
`.trim();

const OFFPAY_ANDROID_PROGUARD_MARKER =
  '-keep class com.munimbluetooth.** { *; }';

function withAndroidProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const proguardRulesPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );

      let contents = '';
      try {
        contents = await fs.promises.readFile(proguardRulesPath, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      if (!contents.includes(OFFPAY_ANDROID_PROGUARD_MARKER)) {
        const nextContents = `${contents.replace(/\s*$/, '')}\n\n${OFFPAY_ANDROID_PROGUARD_RULES}\n`;
        await fs.promises.mkdir(path.dirname(proguardRulesPath), {
          recursive: true,
        });
        await fs.promises.writeFile(proguardRulesPath, nextContents);
      }

      return modConfig;
    },
  ]);
}

module.exports = withAndroidProguardRules;
