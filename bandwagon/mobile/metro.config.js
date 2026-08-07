const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// The shared types/apiClient live inside the app (src/shared) rather than at
// ../packages/shared, because EAS archives only the Expo project root — a
// `file:../packages/shared` dependency isn't in the upload and `npm ci` fails
// on the builder. The alias keeps the existing `@bandwagon/shared` import
// specifiers working. Metro doesn't read tsconfig `paths`, so this has to be
// declared here as well as in tsconfig.json.
config.resolver.alias = {
  ...config.resolver.alias,
  '@bandwagon/shared': path.resolve(__dirname, 'src/shared'),
};

module.exports = withNativeWind(config, { input: './global.css' });
