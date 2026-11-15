# Sidebar buttons

Checked the live preview at `http://127.0.0.1:8080/` on 2026-11-12. Surface is `aside.rail.gpt-rail` only. Viewports: 1280×800 and 390×844. Signed out. No pins and no recent chats, so those rows were not in the DOM.

On desktop the rail is always visible (288px, or 72px when collapsed). On the phone it is `display: none` until the header **Open menu** button opens it as a full-screen drawer (`nav-drawer-open`, 390×844). That opener is outside the rail. Clicking the drawer’s own padding closes it. The phone bottom bar (`aria-label="Primary"`) is hidden by the shell CSS and was not part of this surface.

## Working

| Control | Where | What a click does |
| --- | --- | --- |
| Search workspace | Desktop | Opens the header command palette and focuses the search field. |
| Close menu | Phone drawer only | Closes the drawer. `display: none` on desktop. |
| Collapse sidebar / Expand sidebar | Desktop only | Toggles the rail between 288px and 72px. Icon-only nav still switches views. Hidden on the phone. |
| Library | Both | Sets the view to `files` (title Library) and closes the phone drawer. |
| Projects | Both | Sets the view to `projects` and closes the phone drawer. |
| Plugins | Both | Sets the view to `connected` (header title Connected) and closes the phone drawer. |
| Scheduled | Both | Sets the view to `scheduled` and closes the phone drawer. |
| Explore | Both, link not a button | Goes to `/explore` and leaves the command shell. |
| See all… | Expanded rail only | Sets the view to `chat` (title Thread). It does not open a list of every chat. Hidden while the rail is collapsed. |
| Chat | Phone drawer; desktop when the footer is not covered | Sets the view to `command` and closes the phone drawer. Confirmed phone Library → Chat returns to command. On desktop command view it is already there, so the click is a no-op besides staying on Chat. |
| Open Settings | Phone drawer; desktop command view | Sets the view to `settings`. On Plugins (`connected`) and Settings the signed-out banner is hidden, so the footer is also reachable there. |

## Dead (pointer does nothing)

| Control | Where | What happens |
| --- | --- | --- |
| Dashboard | Both, link not a button (`nav-route-dashboard`, also `sr-only`) | Not a hit target. Desktop box is 1×44px. On the open phone drawer the layout box is full width, but `clip` / overflow still sends the point to the `<nav>` behind it, which has no click handler. A scripted `click()` does navigate to `/dashboard`. A real pointer click does not. |
| Search workspace | Phone | Closes the drawer and sets the palette open in state, but `.command-search` is `display: none` (0×0). The palette is not visible and focus stays on Open menu. It does not search. |
| Chat and Open Settings | Desktop, signed out, views other than command / connected / settings | The signed-out banner (`position: fixed; left: 1rem; bottom: 1rem; z-index: 49`) covers the rail footer. Measured on Library: Chat at y=744 and Settings at x=231 are both under the banner, so pointer clicks do nothing. The handlers still work if something else activates them (Chat returns to command). |

## Not on screen

Empty workspace. These buttons exist in the rail only when data is present, and were not rendered:

- Each pinned chat, agent, project, or file. A click would open that chat, or switch to agents, projects, or files.
- Each of up to five recent chat titles. A click would open that chat.
- Each recent-row Pin control (`Pin {title}`). A click would toggle that chat’s pin.

No rail `<button>` lacked a click handler. The dead cases are hit-testing and a hidden search field, not missing `onClick`s.
