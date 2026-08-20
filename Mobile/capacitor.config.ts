import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.clashdrive.app",
  appName: "Clash Drive",
  webDir: "dist",
  android: {
    // http://localhost is a secure context in Android WebView,
    // which keeps the streaming Service Worker functional in the native app.
    androidScheme: "http",
    allowMixedContent: true,
  },
  server: {
    androidScheme: "http",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#121318",
      showSpinner: false,
    },
  },
};

export default config;