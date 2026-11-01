Voice round3 stop @ 04f79e3 (Africa/Lagos)
Fix: Direct ?voiceTestAudio=hello stayed Listening — speakText queued while responseBusy after captureOnly cancel; response.done never flushed speakQueue. Always flush speakQueue + pendingForce after busy cancel.
Clips: hello -> 'hello', question -> 'What time is it?' (dictation + realtime aligned).
Tests: speak-after-busy.test.ts; e2e asserts transcript->Speaking under test audio.
Typecheck: clean.
Notion parent insert_content: failed validation_error/invalid_input (sync + async task_05904715b80f4f59ab86f6ee7239d337). Child page created instead: https://app.notion.com/p/40bb95f33e42814ead93e23ebdaf3198
URLs: http://127.0.0.1:8091/?voiceTestAudio=hello | http://127.0.0.1:8091/?voiceTestAudio=question
Lock: released.
