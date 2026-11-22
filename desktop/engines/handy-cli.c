#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

typedef int transcribe_status;
struct transcribe_session;

__declspec(dllimport) transcribe_status transcribe_init_backends(const char *artifact_dir);
__declspec(dllimport) transcribe_status transcribe_open(const char *path, const void *load_params, const void *session_params, struct transcribe_session **out_session);
__declspec(dllimport) transcribe_status transcribe_run(struct transcribe_session *session, const float *pcm, int n_samples, const void *params);
__declspec(dllimport) const char *transcribe_full_text(const struct transcribe_session *session);
__declspec(dllimport) void transcribe_close(struct transcribe_session *session);
__declspec(dllimport) const char *transcribe_status_string(transcribe_status status);

static int read_wav_f32(const char *path, float **out, int *count) {
  FILE *file = fopen(path, "rb");
  unsigned char header[12];
  int rate = 0;
  short channels = 0;
  short bits = 0;
  unsigned char *pcm = NULL;
  int samples = 0;
  int i;
  if (!file) return 1;
  if (fread(header, 1, 12, file) != 12 || memcmp(header, "RIFF", 4) != 0) {
    fclose(file);
    return 1;
  }
  for (;;) {
    unsigned char chunk[8];
    unsigned int size;
    if (fread(chunk, 1, 8, file) != 8) break;
    size = (unsigned int)chunk[4] | ((unsigned int)chunk[5] << 8) | ((unsigned int)chunk[6] << 16) | ((unsigned int)chunk[7] << 24);
    if (memcmp(chunk, "fmt ", 4) == 0) {
      unsigned char fmt[16];
      if (size < 16 || fread(fmt, 1, 16, file) != 16) {
        fclose(file);
        return 1;
      }
      channels = (short)(fmt[2] | (fmt[3] << 8));
      rate = (int)fmt[4] | ((int)fmt[5] << 8) | ((int)fmt[6] << 16) | ((int)fmt[7] << 24);
      bits = (short)(fmt[14] | (fmt[15] << 8));
      if (size > 16) fseek(file, (long)(size - 16 + (size & 1)), SEEK_CUR);
    } else if (memcmp(chunk, "data", 4) == 0) {
      pcm = (unsigned char *)malloc(size);
      if (!pcm || fread(pcm, 1, size, file) != size) {
        free(pcm);
        fclose(file);
        return 1;
      }
      samples = (int)(size / (unsigned int)(channels > 0 ? channels * (bits / 8) : 1));
      break;
    } else {
      fseek(file, (long)(size + (size & 1)), SEEK_CUR);
    }
  }
  fclose(file);
  if (!pcm || rate != 16000 || bits != 16 || channels < 1) {
    free(pcm);
    return 1;
  }
  *out = (float *)malloc((size_t)samples * sizeof(float));
  if (!*out) {
    free(pcm);
    return 1;
  }
  for (i = 0; i < samples; i += 1) {
    int offset = i * channels * 2;
    short value = (short)(pcm[offset] | (pcm[offset + 1] << 8));
    (*out)[i] = (float)value / 32768.0f;
  }
  free(pcm);
  *count = samples;
  return 0;
}

static const char *flag(int argc, char **argv, const char *name) {
  int i;
  for (i = 1; i < argc - 1; i += 1) {
    if (strcmp(argv[i], name) == 0) return argv[i + 1];
  }
  return NULL;
}

int main(int argc, char **argv) {
  const char *model = flag(argc, argv, "-m");
  const char *out_path = flag(argc, argv, "-o");
  const char *wav = NULL;
  char dir[MAX_PATH];
  struct transcribe_session *session = NULL;
  float *pcm = NULL;
  int count = 0;
  transcribe_status status;
  const char *text;
  FILE *out;
  int i;
  for (i = 1; i < argc; i += 1) {
    if (argv[i][0] != '-') wav = argv[i];
    else if (i + 1 < argc && (strcmp(argv[i], "-m") == 0 || strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "-l") == 0 || strcmp(argv[i], "--timestamps") == 0)) i += 1;
  }
  if (!model || !wav || !out_path) {
    fprintf(stderr, "usage: transcribe-cli -m model.gguf audio.wav -o transcript.txt\n");
    return 2;
  }
  GetModuleFileNameA(NULL, dir, MAX_PATH);
  {
    char *slash = strrchr(dir, '\\');
    if (!slash) slash = strrchr(dir, '/');
    if (slash) *slash = 0;
  }
  status = transcribe_init_backends(dir);
  if (status != 0) {
    fprintf(stderr, "Handy backends did not start: %s\n", transcribe_status_string(status));
    return 1;
  }
  status = transcribe_open(model, NULL, NULL, &session);
  if (status != 0 || !session) {
    fprintf(stderr, "Handy could not open the model: %s\n", transcribe_status_string(status));
    return 1;
  }
  if (read_wav_f32(wav, &pcm, &count) != 0) {
    transcribe_close(session);
    fprintf(stderr, "The recording was not 16 kHz mono PCM.\n");
    return 1;
  }
  status = transcribe_run(session, pcm, count, NULL);
  free(pcm);
  if (status != 0) {
    fprintf(stderr, "Handy did not transcribe: %s\n", transcribe_status_string(status));
    transcribe_close(session);
    return 1;
  }
  text = transcribe_full_text(session);
  out = fopen(out_path, "wb");
  if (!out) {
    transcribe_close(session);
    return 1;
  }
  if (text) fputs(text, out);
  fclose(out);
  transcribe_close(session);
  return 0;
}
