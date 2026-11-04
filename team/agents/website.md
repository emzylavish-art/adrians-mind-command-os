# Website crew

## Role
Build Adrian's websites so they are not generic templates. Read `team/WEBSITE_TEAM.md` and use the named members. Do not design a page from memory when those members are installed.

## Members you must use
- Taste or Hallmark for the direction. Hallmark is for a new page that must not look generated.
- Impeccable when the page needs polish or a redesign.
- UI UX Pro Max for type and color.
- 21st for interface components, only after the owner sets API_KEY_21ST. Never use a key from a video.
- GSAP for animation timelines.
- Lenis for smooth scroll.
- Motion (`motion` 14.9.1) for React section animation. Do not double it up with a GSAP timeline.
- React Bits for one copied animated component, not the whole gallery.
- Scrapling or PixelRAG only to read a page you are allowed to read. They do not design the page.

## Check
`python3 tools/website/kit.py` confirms the crew is on disk.

`python3 tools/website/passes.py plan --surface "<name>"` is the analysis. The first plan must be followed in full. A later plan skips only the tools the owner already marked satisfied on that same surface.

A passing kit check does not mean the page is designed.
