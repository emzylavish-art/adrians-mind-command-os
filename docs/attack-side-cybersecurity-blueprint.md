# Attack-Side Cybersecurity Blueprint
## Phase 1: Linux Foundations (Starting Point)

**Goal:** Build the foundation required to understand and practice offensive techniques safely. Linux is the primary environment for nearly all modern offensive security work.

### Why Start With Linux
- Most security tools, labs, and real-world attack environments run on Linux.
- Understanding the file system, permissions, processes, and package management is required before tools like Burp Suite, Metasploit, or custom scripts make sense.
- Live USB / Kali setups allow practice without modifying your main Windows machine.

### Core Topics
1. **File System Hierarchy** — `/`, `/home`, `/etc`, `/var`, `/tmp`, `/usr`, `/bin`, `/sbin`
2. **Navigation & File Operations** — `pwd`, `ls`, `cd`, `cat`, `less`, `grep`, `find`, `mkdir`, `cp`, `mv`, `rm`
3. **Permissions** — `chmod`, `chown`, `umask`, reading `rwx` notation
4. **Users & Processes** — `whoami`, `id`, `ps`, `top`, `kill`, sudo
5. **Package Management** — `apt update`, `apt install`, `apt upgrade`
6. **Networking Basics** — `ip a`, `ss`, `curl`, `wget`

### Recommended Practice Path
- Create a Kali Live USB (persistent if possible).
- Work through basic commands until they feel natural.
- Complete simple CTF-style challenges that require only terminal skills.
- Progress to NetworkChuck’s “Linux for Hackers” series or equivalent.

### Checkpoints
- Can navigate and manipulate files without a GUI.
- Understand permission models and can set them correctly.
- Can install and run tools via apt.
- Comfortable reading man pages and error messages.

---

### Later Phases (Outline)
- Phase 2: Networking fundamentals (TCP/IP, DNS, HTTP)
- Phase 3: Web application attacks (OWASP Top 10, Burp Suite)
- Phase 4: AI / LLM / Agent security (prompt injection, tool abuse)
- Phase 5: Defense and detection after attack mastery

*This blueprint is designed so each phase builds on the previous one. Practical testing should be interleaved with conceptual learning.*
