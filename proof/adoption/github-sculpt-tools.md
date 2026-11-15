# GitHub tools checked for the failed sculpt

Checked 2026-11-15. Nothing was installed.

[pixiv/three-vrm](https://github.com/pixiv/three-vrm) is MIT, not archived, and was pushed on 2026-10-22. It loads a VRM file in Three.js. It does not include a body. A VRM character would be a different person, so it was not downloaded.

[MakeHuman](https://github.com/makehumancommunity/makehuman) was pushed on 2024-08-19. GitHub reports no SPDX license. The project site says core assets are CC0 and the source is AGPL. The AGPL app was not installed. A CC0 base mesh could replace the lathe later, but only as a file, not by embedding the app.

The official Three.js decal projector is already in this repo at `node_modules/three/examples/jsm/geometries/DecalGeometry.js`, from Three.js 0.187.0. Importing it through Vite returned HTTP 504 and the EVE page stopped loading. That import was removed. The readable face plate is the circle again.

VRoid's old beta samples are marked CC0 on Pixiv's help page, but they are a different person. They were not downloaded. Eve's face stays `public/brand/eve-idle.jpg`.
