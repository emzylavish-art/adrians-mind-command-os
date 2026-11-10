# Digital human

EVE is a 3D figure in the existing app. The body, head, arms and legs are an original Three.js model (`src/lib/mind/avatar/human-rig.ts`). The face is her photograph, cropped onto the head. This is not a downloaded GLB, VRM, Ready Player Me avatar, or a commercial face SDK. No license fee was paid.

## Where she appears

- Command home, large, as soon as the app opens.
- Chat, compact.
- EVE Workbench, with framing (`full`, `upper`, `face`, `compact`), expression override, character choice, and voice preview.

Framing is stored at `amcos.avatar.framing.v1`. The same character is used in every framing. The page does not regenerate her.

## Motion

- Head turns and the torso breathes unless `prefers-reduced-motion` is set.
- Blink is painted on the face photograph about every three seconds.
- Gaze is a small shift of that photograph. The separate eye meshes stay hidden so they do not double up on the photo.
- While she speaks, the jaw opens by viseme (`aa`, `ee`, `oo`, `mm`, rest) and the face photograph swaps to the matching plate when one exists.

## Lip sync

Letters are mapped to visemes and spread across the audio duration.

- MPEG Speak uses `SharedAudioOutput` current time and duration. The mouth closes when playback stops or is interrupted.
- Live PCM has no duration, so the mouth uses 55 ms per letter from the moment the spoken text is known. That is not sample-accurate.
- If the portrait fails to load, the stage drops to the flat photograph and says so. It does not invent a successful face.

## Characters

EVE, Liora, Iris, Luna, and Aurora share this body rig with different colors and their own face plates. EVE has expression plates and four visemes. The others have a closed mouth and an `aa` viseme. The roster still allows ten female and ten male identities. Empty slots stay empty. None of them grant tools. They all use Adrian Core.

## License

Plates in `public/characters/` were generated for this project. See `public/characters/SOURCE.md`. Do not replace the body with an unlicensed model.
