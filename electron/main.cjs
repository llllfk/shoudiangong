const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const APP_URL =
  process.env.ELECTRON_APP_URL?.trim() || "https://556fwr627w.coze.site";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "受电弓智能检修系统",
    backgroundColor: "#0B1E3A",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);

  // 外链用系统浏览器打开，应用内只保留本站
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const allowed = new URL(APP_URL);
      if (target.origin === allowed.origin) {
        return { action: "allow" };
      }
    } catch {
      // ignore
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
