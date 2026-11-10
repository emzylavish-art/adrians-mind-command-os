# Digital human

EVE and the other filled characters are original photographic plates drawn on a canvas. This is not a Three.js body, not a VRM, and not a Ready Player Me model. No licensed GLB was available, so none was invented.

## What is on screen

- Chat, the command home, and the EVE Workbench render `DigitalHuman`.
- Framing is `full`, `upper`, `face`, or `compact`. The choice is stored at `amcos.avatar.framing.v1`.
- The same character configuration is used in every framing. Switching pages does not regenerate the face.
- EVE has a full-body plate plus closed-mouth, listening, thoughtful, concerned, and smiling plates, and four visemes: `aa`, `ee`, `oo`, `mm`.
- Liora, Iris, Luna, and Aurora have a closed-mouth plate and an `aa` viseme only. Missing shapes fall back to `aa` or the closed mouth. Male slots are reserved and empty.

## Lip sync

Speech text is mapped letter to viseme (`planVisemes`) and spread across the audio duration.

- MPEG playback from Speak / preview uses `SharedAudioOutput` `currentTime` and `duration`. The mouth returns to rest when that audio ends or is interrupted.
- Live PCM has no single duration. The mouth follows an estimate of 55 ms per letter from the moment the spoken text is known. That estimate is not sample-accurate.
- A random jaw loop is not used. If the portrait files fail to load, the caption says so and nothing is simulated.

## Motion

Blink and a small breath scale run unless `prefers-reduced-motion: reduce` is set. Blink samples a pixel from the plate. It is not a separate eye model. The full-body plate is not given a face-band mouth or blink.

## State

Presence is one shared store: idle, listening, processing, speaking, interrupted, waiting for approval, executing, error, offline. It follows the emergency stop, the realtime voice status, Speak playback, and saved runs that are actually `waiting_approval` or `running`. It does not invent progress.

## License

The plates were generated for this project and are stored in `public/characters/`. See `public/characters/SOURCE.md`. They are not a third-party face rig. Do not replace them with an unlicensed model.
