Safe Keys status

No secret values are in this file. The key files live only at /home/box/.secrets/safe-keys on the machine that created them. Each file is mode 600.

- voice: adrians-mind-voice-realtime, id 1535cc0f-99ff-4e87-912a-4492c84ae274, hint xai-...tcnb. Voice, speech to text, text to speech.
- chat: adrians-mind-chat, id 2689c622-924c-411a-b463-e2c319a35ec1, hint xai-...QeKV. Grok 4.3, 4.5, 4.6, 4.7 text chat.
- image: adrians-mind-image, id c5eb8635-0fe2-4efb-af95-3f3541dfe3d7, hint xai-...2zR1. Image models only.
- video: adrians-mind-video, id 16fd401e-6cc3-42ae-a92f-7c7c28a31fc7, hint xai-...W4Qy. Video models only.
- code: adrians-mind-code, id 9bc22cba-7789-43b2-9aa8-b32d9de6fc24, hint xai-...fWRD. grok-build and Grok 4.5.

Each key is limited to 2 requests a second and 30 a minute. The management key was not stored.

Platform work still open: a signed-in Safe Keys page that reads these server files and lets the owner reveal and copy a value. Do not put the values in git, in the browser bundle, or in a public page.
