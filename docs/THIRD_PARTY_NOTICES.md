# Third-party acknowledgements

## Obsidian 3D Graph (Yomaru)

- Project: https://github.com/HananoshikaYomaru/obsidian-3d-graph
- Author: Yeung Man Lung Ken (Hananoshika Yomaru); portions of the upstream project retain Alexander Weichart's copyright.
- License: MIT.
- Use in Adrian's Mind: the dashboard adapts the project's 3D knowledge-graph interaction model. The Obsidian plugin itself is not installed or bundled; its Obsidian-specific runtime is not part of Adrian's Mind.

The upstream MIT license and notices remain with the original project.

Adrian's Mind embeds a web adaptation of the same graph stack the plugin uses for layout and exploration:

- Graph engine package: `3d-force-graph` (vasturiano), also MIT, as used by Yomaru's ForceGraph host.
- Interaction patterns adapted into `src/components/mind/dashboard-3d/fleet-force-graph.tsx`: orbit camera, degree-scaled nodes, neighbour highlight on hover, Ctrl/Cmd-click focus fly-to, directional particles on highlight, and query/health filters bound to Adrian fleet + Notion status payloads.
- Obsidian desktop APIs, vault file openers, Dataview search engines, and plugin settings UI are not carried over.
