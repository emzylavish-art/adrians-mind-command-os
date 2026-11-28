const path = require("node:path");
const fs = require("node:fs");
const builtins = /^\/chat-bits\/(pip|dewy|ember|hoots|rocky|seedy|stacky)\.png$/;
const uploaded = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
function validImage(image) {
  return typeof image === "string" && (builtins.test(image) || (image.length < 800000 && uploaded.test(image)));
}
function registerChatBits({ host, origin, electron }) {
  const { BrowserWindow, screen, ipcMain } = electron;
  let widget = null, loaded = false, latest = null, corner = null;
  function close() {
    if (widget && !widget.isDestroyed()) widget.destroy();
    widget = null; loaded = false; latest = null; corner = null;
  }
  function place(side) {
    const area = screen.getDisplayMatching(host.getBounds()).workArea;
    widget.setPosition(side === "left" ? area.x + 16 : area.x + area.width - 110, area.y + area.height - 124);
  }
  ipcMain.handle("adrian-bits-configure", async (event, input) => {
    if (event.sender !== host.webContents || !event.senderFrame || event.senderFrame !== host.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) return false;
    if (input?.visible !== true) { close(); return true; }
    if (!validImage(input.image)) return false;
    const assetRoot = path.join(__dirname, "chat-bits");
    const fallback = path.join(__dirname, "../public/chat-bits");
    const assets = fs.existsSync(assetRoot) ? assetRoot : fallback;
    const src = builtins.test(input.image) ? "data:image/png;base64," + fs.readFileSync(path.join(assets, path.basename(input.image))).toString("base64") : input.image;
    latest = {src, name:String(input.name || "Chat Bit").slice(0,50)};
    if (!widget || widget.isDestroyed()) {
      widget = new BrowserWindow({width:94,height:104,frame:false,transparent:true,alwaysOnTop:true,resizable:false,skipTaskbar:true,show:false,
        webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,"chat-bits-widget-preload.cjs")}});
      const current = widget;
      current.webContents.setWindowOpenHandler(() => ({action:"deny"}));
      current.webContents.on("will-navigate", event => event.preventDefault());
      current.once("closed", () => { if(widget===current){widget=null;loaded=false;corner=null;} });
      const pending = current.loadFile(path.join(__dirname,"chat-bits-widget.html"));
      place(input.corner); corner=input.corner;
      try {await pending;} catch {if(widget===current)close();return false;}
      if(widget!==current || current.isDestroyed()) return false;
      loaded = true;
    }
    if (corner !== input.corner) {place(input.corner);corner=input.corner;}
    if (loaded && latest) {widget.webContents.send("adrian-bits-selection",latest);widget.showInactive();}
    return true;
  });
  const activate = (event) => {
    if (!widget || event.sender !== widget.webContents || host.isDestroyed() || new URL(host.webContents.getURL()).origin !== origin) return;
    if (host.isMinimized()) host.restore(); host.show(); host.focus();host.webContents.send("adrian-bits-chat");
  };
  ipcMain.on("adrian-bits-activate",activate);
  host.webContents.on("did-start-navigation", (_event, _url, sameDocument, main) => {if(main && !sameDocument)close();});
  return () => {close();ipcMain.removeHandler("adrian-bits-configure");ipcMain.removeListener("adrian-bits-activate",activate);};
}
module.exports={ registerChatBits, validImage };
