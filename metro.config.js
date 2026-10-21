// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The admin dashboard (admin-web/) and Edge Functions are separate projects: keep Metro out of
// them (their own node_modules would otherwise be crawled and could clash with the app's).
config.resolver.blockList = [/[\/]admin-web[\/].*/, /[\/]supabase[\/]functions[\/].*/];

module.exports = config;
