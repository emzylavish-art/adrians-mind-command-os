# Website team

This team builds websites. Any AI working in this repository starts here when the job is a site, a landing page, or an app screen. Do not invent a generic page from scratch.

The motion crew below is what stops the site looking like every other generated template. Taste decides the look. These members do the motion and the interface parts.

| Member | What it is | How to use it |
|---|---|---|
| Taste | Art direction | Study craft. Do not copy Manus, GPT, Grok, or any other product. |
| UI UX Pro Max | Style, palette, and type database | Search it before picking colors and fonts. |
| 21st | Interface library | Component search and logos. Live use needs the owner's own 21st.dev key. |
| GSAP | Professional animation | Timelines, transforms, and sequenced motion. Package `gsap` 3.15.1. |
| Lenis | Smooth scroll | The scroll feels finished instead of default. Package `lenis` 1.3.27. Use it with GSAP, not instead of it. |
| React Bits | Animated React components | Copy the one component the page needs. Text, backgrounds, cards, buttons. Do not dump the whole library into the site. |

Installed packages live in `tools/website`. Source checkouts live in `upstream/gsap`, `upstream/lenis`, and `upstream/react-bits`.

## Rule

A page is not done because the sections exist. It is done when Taste has a direction, the type and color came from a real system, motion came from GSAP or a React Bits component, and scroll came from Lenis when the page scrolls. Say which member did the work. Do not claim a member ran if its files were only listed.

React Bits is MIT plus Commons Clause. Use the components inside Adrian's sites. Do not resell the library.

The hacker library is not in this team. It stays in its own repo for server security.
