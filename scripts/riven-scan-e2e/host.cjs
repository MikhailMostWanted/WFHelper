const { app } = require("electron");

if (!process.env.WFHELPER_USER_DATA) throw new Error("Riven harness requires isolated user data");
app.setPath("userData", process.env.WFHELPER_USER_DATA);
app.disableHardwareAcceleration();
app.whenReady().catch((error) => {
  console.error(error);
  app.exit(1);
});
