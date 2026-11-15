# Trust boundary

Adrian OS can be tested on the website today. It is not Windows software. A desktop build stays unbuilt until you explicitly approve it.

The hosted demo can already open Speak as a system call. The face stays on the Intelligence layer, and the call screen does not show it. The microphone can keep recording after you leave Speak, but only inside this browser tab. Closing the tab stops the tracks. The recording cannot continue after the tab closes, and it cannot follow you into other Windows apps.

The emergency stop is on the same screen. Only you can press it. While it is on, Approve and Run stay disabled, and EVE cannot clear it. The four hosted actions are file read, file write, file delete, and a terminal command. Run stays disabled until you approve that exact action. Approving a file write does not approve a file read, a delete, or the terminal. After approval, those four run in the hosted workspace only. A preview already wrote a file, read it back as hosted owner flow, deleted it, and printed hosted-ok from the terminal. Your Windows PC was not touched.

Mouse movement, keyboard input, a browser pointer on your PC, and files on your Windows PC stay blocked. So does the microphone after the browser or tab closes, and so does Windows desktop software itself. Pairing a computer, clicking Approve on the website, or speaking to EVE does not turn those on. A future desktop program would still have to ask you to approve each exact action, and the emergency stop would still refuse every action while it is on. That program does not exist yet.

This brief does not approve a desktop build, a deploy, or a production release. It only records the line between the hosted demo you can test now and the Windows capabilities that remain blocked.
