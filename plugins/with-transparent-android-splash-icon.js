/**
 * Android transparent-splash plugin.
 *
 * Goal: keep the launcher splash a flat brand-colour rectangle with no
 * logo. We can't simply omit the icon because the Android 12+ splash
 * API forces a centered icon; if we don't supply one Android falls
 * back to the launcher icon. Best practice from the official splash
 * API docs (https://developer.android.com/develop/ui/views/launch/splash-screen):
 *
 *   - `windowSplashScreenBackground` paints the window before our app
 *     is drawn. We point it at our brand colour so the system splash
 *     and the React Native first-paint share the same colour.
 *   - `windowSplashScreenAnimatedIcon` must be a vector drawable
 *     (or an `<animated-vector>`). Shape drawables work on some OEM
 *     skins but get ignored on others — Pixel + recent Samsung have
 *     both shipped firmwares that fall back to the launcher icon when
 *     the supplied animated-icon drawable is a `<shape>` instead of a
 *     `<vector>`. Using a fully transparent vector with a valid
 *     viewport is the documented "no icon" approach.
 *   - `windowSplashScreenIconBackgroundColor` is set to transparent
 *     so the brand colour shows through the icon's circular cutout
 *     on Android 12+.
 *   - `postSplashScreenTheme` swaps the activity to `AppTheme` once
 *     the splash hands off to React Native.
 *
 * Mod ordering note (SDK 54, @expo/config-plugins):
 *   - `dangerous` mods run FIRST (precedence -2 in mod-compiler.js).
 *   - Structured mods (`withAndroidStyles`, `withAndroidColors`, etc.)
 *     run after, in the order they were registered.
 *   - `expo-splash-screen` registers its own `withAndroidStyles` that
 *     adds `Theme.App.SplashScreen` pointing at `@drawable/splashscreen_logo`.
 *   - Because we declare this plugin AFTER `expo-splash-screen` in
 *     `app.config.ts`, our `withAndroidStyles` runs after theirs, so
 *     we can deterministically keep the splash style pointed at
 *     `splashscreen_logo` while making that drawable transparent.
 *   - The dangerous mod is reserved for writing brand-new files
 *     (the transparent logo drawable + adaptive-icon background +
 *     `values-v31/styles.xml`) which no other Expo mod owns.
 */
const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
  withDangerousMod,
  withMainActivity,
} = require('expo/config-plugins');

const SPLASH_BACKGROUND_COLOR = '#5BC8E8';
const SPLASH_STYLE_NAME = 'Theme.App.SplashScreen';
const SPLASH_LOGO_DRAWABLE = 'splashscreen_logo';
const TRANSPARENT_SPLASH_DRAWABLE = 'splashscreen_transparent';

function setColor(colors) {
  return AndroidConfig.Colors.assignColorValue(colors, {
    name: 'splashscreen_background',
    value: SPLASH_BACKGROUND_COLOR,
  });
}

function writeFileIfChanged(filePath, contents) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

/**
 * Build the splash style block string used in `values-v31/styles.xml`
 * (Android 12+). The structured `withAndroidStyles` below builds the
 * equivalent in-memory object for `values/styles.xml`.
 */
function buildSplashStyleBlock({ includeIconBackground }) {
  const lines = [
    `  <style name="${SPLASH_STYLE_NAME}" parent="Theme.SplashScreen">`,
    '    <item name="windowSplashScreenBackground">@color/splashscreen_background</item>',
    `    <item name="windowSplashScreenAnimatedIcon">@drawable/${SPLASH_LOGO_DRAWABLE}</item>`,
    '    <item name="postSplashScreenTheme">@style/AppTheme</item>',
    '    <item name="android:windowSplashScreenBehavior">icon_preferred</item>',
  ];
  if (includeIconBackground) {
    lines.push(
      '    <item name="windowSplashScreenIconBackgroundColor">@android:color/transparent</item>',
    );
  }
  lines.push('  </style>');
  return lines.join('\n');
}

/**
 * Strip the `SplashScreenManager.registerOnActivity(this)` call that
 * `expo-splash-screen` injects into MainActivity, so the activity
 * relies on the system splash theme alone. Asserts the incoming
 * source either has the call (so we can remove it) or already calls
 * `setTheme(R.style.AppTheme)`. Anything else fails the EAS cloud
 * build loudly with a clear message.
 */
function keepMainActivityOnThemeOnlySplash(contents) {
  const hasManagerCall = /SplashScreenManager\.registerOnActivity\(this\)/.test(contents);
  const hasManualSetTheme = /setTheme\(R\.style\.AppTheme\)/.test(contents);

  if (!hasManagerCall && !hasManualSetTheme) {
    throw new Error(
      'with-transparent-android-splash-icon: MainActivity is missing both the ' +
        'expo-splash-screen `SplashScreenManager.registerOnActivity` call and a ' +
        'manual `setTheme(R.style.AppTheme)` invocation. The upstream Expo splash ' +
        'wiring may have changed; review the plugin against the current ' +
        '`expo-splash-screen` MainActivity output before continuing.',
    );
  }

  let next = contents.replace(
    /\nimport expo\.modules\.splashscreen\.SplashScreenManager\r?\n/g,
    '\n',
  );

  next = next.replace(
    /^(\s*)SplashScreenManager\.registerOnActivity\(this\);?\s*$/m,
    '$1setTheme(R.style.AppTheme)',
  );

  if (!/setTheme\(R\.style\.AppTheme\)/.test(next)) {
    next = next.replace(
      /^(\s*)super\.onCreate\(null\);?\s*$/m,
      '$1setTheme(R.style.AppTheme)\n$1super.onCreate(null)',
    );
  }

  return next;
}

function buildTransparentVectorDrawable() {
  return [
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="1dp"',
    '    android:height="1dp"',
    '    android:viewportWidth="1"',
    '    android:viewportHeight="1">',
    '  <path',
    '      android:fillColor="#00000000"',
    '      android:pathData="M0,0h1v1h-1z"/>',
    '</vector>',
    '',
  ].join('\n');
}

function writeTransparentDrawable(mainResPath, drawableName) {
  writeFileIfChanged(
    path.join(mainResPath, 'drawable', `${drawableName}.xml`),
    buildTransparentVectorDrawable(),
  );
}

function overwriteGeneratedSplashLogoPngs(projectRoot, mainResPath) {
  const transparentPngPath = path.join(projectRoot, 'assets', 'splash-transparent.png');
  if (!fs.existsSync(transparentPngPath)) {
    return;
  }

  for (const entry of fs.readdirSync(mainResPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('drawable')) {
      continue;
    }

    const logoPngPath = path.join(mainResPath, entry.name, `${SPLASH_LOGO_DRAWABLE}.png`);
    if (fs.existsSync(logoPngPath)) {
      fs.copyFileSync(transparentPngPath, logoPngPath);
    }
  }
}

module.exports = function withTransparentAndroidSplashIcon(config) {
  config = withAndroidColors(config, (colorsConfig) => {
    colorsConfig.modResults = setColor(colorsConfig.modResults);
    return colorsConfig;
  });

  config = withAndroidColorsNight(config, (colorsConfig) => {
    colorsConfig.modResults = setColor(colorsConfig.modResults);
    return colorsConfig;
  });

  // Rewrite the in-memory `values/styles.xml` model so Expo's generated
  // `splashscreen_logo` resource is a transparent vector, not a visible
  // app icon. Keeping Expo's resource name avoids stale native styles
  // pointing at a missing drawable after prebuild/run regeneration.
  config = withAndroidStyles(config, (stylesConfig) => {
    const resources = stylesConfig.modResults.resources ?? {};
    const existing = resources.style ?? [];
    resources.style = [
      ...existing.filter((entry) => entry?.$?.name !== SPLASH_STYLE_NAME),
      {
        $: { name: SPLASH_STYLE_NAME, parent: 'Theme.SplashScreen' },
        item: [
          {
            $: { name: 'windowSplashScreenBackground' },
            _: '@color/splashscreen_background',
          },
          {
            $: { name: 'windowSplashScreenAnimatedIcon' },
            _: `@drawable/${SPLASH_LOGO_DRAWABLE}`,
          },
          { $: { name: 'postSplashScreenTheme' }, _: '@style/AppTheme' },
          { $: { name: 'android:windowSplashScreenBehavior' }, _: 'icon_preferred' },
        ],
      },
    ];
    stylesConfig.modResults.resources = resources;
    return stylesConfig;
  });

  config = withMainActivity(config, (activityConfig) => {
    activityConfig.modResults.contents = keepMainActivityOnThemeOnlySplash(
      activityConfig.modResults.contents,
    );
    return activityConfig;
  });

  // Dangerous mod: write files that no other Expo mod owns. These run
  // before structured mods, so anything we write here must not be
  // touched by `expo-splash-screen` afterwards.
  return withDangerousMod(config, [
    'android',
    (dangerousConfig) => {
      const mainResPath = path.join(
        dangerousConfig.modRequest.projectRoot,
        'android/app/src/main/res',
      );

      // Vector drawables, fully transparent, with a 1x1dp viewport.
      // `splashscreen_logo` is the resource Expo's splash style expects.
      // `splashscreen_transparent` stays as a compatibility alias for
      // native files generated by older versions of this local plugin.
      writeTransparentDrawable(mainResPath, SPLASH_LOGO_DRAWABLE);
      writeTransparentDrawable(mainResPath, TRANSPARENT_SPLASH_DRAWABLE);
      overwriteGeneratedSplashLogoPngs(dangerousConfig.modRequest.projectRoot, mainResPath);

      // Adaptive-icon background — Expo references this drawable when
      // generating mipmap entries. Pointing it at the splash brand
      // colour keeps the launcher icon's negative space colour aligned
      // with the splash window.
      writeFileIfChanged(
        path.join(mainResPath, 'drawable', 'ic_launcher_background.xml'),
        [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">',
          '  <item android:drawable="@color/splashscreen_background"/>',
          '</layer-list>',
          '',
        ].join('\n'),
      );

      // Android 12+ (API 31+) splash theme. `values-v31/` shadows the
      // `values/` copy on Android 12+; we own the file end-to-end and
      // no other Expo mod writes here, so the dangerous mod is safe.
      writeFileIfChanged(
        path.join(mainResPath, 'values-v31', 'styles.xml'),
        [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<resources>',
          buildSplashStyleBlock({ includeIconBackground: true }),
          '</resources>',
          '',
        ].join('\n'),
      );

      return dangerousConfig;
    },
  ]);
};
