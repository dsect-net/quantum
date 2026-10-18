/** Native shells share this web build.
 * Android and iOS: npm run build, then npx cap sync after cap add.
 * Google TV, Wear OS, and Android Auto are layout shells in developer mode
 * until those native projects exist. They are not separate apps.
 */
const config = {
  appId: "net.dsect.singularity",
  appName: "Singularity",
  webDir: "dist",
  server: { androidScheme: "https" },
};

export default config;
