These three scripts are the installer. They work only inside the full Adrian-Social-USB folder.

Copy that folder onto the EliteBook. Do not run these scripts from the browser download folder by themselves. This page cannot hold the Dev weight file. The two Jeff files are still absent and were not downloaded.

1. Right-click install.ps1 and run it with PowerShell.
2. Double-click launch.bat and leave that window open.
3. On the same PC, open http://127.0.0.1:8765/healthz. It should say ok.
4. The listener must be 127.0.0.1:8765. If it is 0.0.0.0 or another port, stop.
5. Run scripts\tunnel.ps1 from the folder. The command must be cloudflared tunnel --url http://127.0.0.1:8765. If it mentions port 9222, stop.
6. Paste the https address and the local secret into the panel. Do not paste the secret into chat.

Not connected is the correct page state until that PC answers. This website does not contain a key.
