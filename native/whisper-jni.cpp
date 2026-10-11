#include <jni.h>
#include <algorithm>
#include <string>
#include "whisper.h"

// whisper.cpp logs every VAD call and decode; keep logcat quiet.
static void quiet(enum ggml_log_level,const char *,void *) {}

extern "C" JNIEXPORT jlong JNICALL Java_ca_kylekeith_shottime_WhisperEngine_load(JNIEnv *env,jclass,jstring path) {
    whisper_log_set(quiet,nullptr);
    const char *file=env->GetStringUTFChars(path,nullptr);
    auto params=whisper_context_default_params();params.use_gpu=false;
    auto *ctx=whisper_init_from_file_with_params(file,params);
    env->ReleaseStringUTFChars(path,file);
    return reinterpret_cast<jlong>(ctx);
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_ca_kylekeith_shottime_WhisperEngine_decode(JNIEnv *env,jclass,jlong handle,jfloatArray input,jint threads,jstring prompt,jboolean fast) {
    auto *ctx=reinterpret_cast<whisper_context *>(handle);
    if(!ctx||!prompt)return nullptr;
    auto params=whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads=threads;params.language="en";params.translate=false;params.no_context=true;
    params.print_realtime=false;params.print_progress=false;params.print_timestamps=false;params.print_special=false;
    params.suppress_blank=true;params.suppress_nst=true;
    // Retry at higher temperature only when the greedy result looks like a repetition loop ("XS, XS, XS, ...").
    params.temperature_inc=0.2f;
    const char *hint=env->GetStringUTFChars(prompt,nullptr);
    params.initial_prompt=hint;
    // The encoder processes a full 30 s window. Sizing it to the section (50 frames per second plus a second)
    // is about 3.5x faster but less accurate, so it is used only when transcription is falling behind.
    const int n=env->GetArrayLength(input);
    if(fast)params.audio_ctx=std::min(1500,n/320+50);
    jfloat *pcm=env->GetFloatArrayElements(input,nullptr);
    int rc=whisper_full(ctx,params,pcm,n);
    env->ReleaseFloatArrayElements(input,pcm,JNI_ABORT);
    env->ReleaseStringUTFChars(prompt,hint);
    if(rc!=0)return nullptr;
    std::string text;
    for(int i=0;i<whisper_full_n_segments(ctx);i++)text+=whisper_full_get_segment_text(ctx,i);
    // Raw bytes: NewStringUTF needs modified UTF-8 and Whisper can emit split or 4-byte characters.
    jbyteArray bytes=env->NewByteArray((jsize)text.size());
    if(bytes)env->SetByteArrayRegion(bytes,0,(jsize)text.size(),reinterpret_cast<const jbyte *>(text.data()));
    return bytes;
}
extern "C" JNIEXPORT void JNICALL Java_ca_kylekeith_shottime_WhisperEngine_release(JNIEnv *,jclass,jlong handle) {
    whisper_free(reinterpret_cast<whisper_context *>(handle));
}
extern "C" JNIEXPORT jlong JNICALL Java_ca_kylekeith_shottime_SpeechDetector_vadLoad(JNIEnv *env,jclass,jstring path) {
    whisper_log_set(quiet,nullptr);
    const char *file=env->GetStringUTFChars(path,nullptr);
    auto params=whisper_vad_default_context_params();params.n_threads=1;params.use_gpu=false;
    auto *vad=whisper_vad_init_from_file_with_params(file,params);
    // Streaming skips the automatic reset. Initialize both LSTM states for each recording,
    // including reopened detectors whose allocated memory may contain the previous session.
    if(vad)whisper_vad_reset_state(vad);
    env->ReleaseStringUTFChars(path,file);
    return reinterpret_cast<jlong>(vad);
}
// Streaming: the LSTM state carries over between reads, so a pause is judged in context.
extern "C" JNIEXPORT jfloatArray JNICALL Java_ca_kylekeith_shottime_SpeechDetector_vadProbs(JNIEnv *env,jclass,jlong handle,jfloatArray input) {
    auto *vad=reinterpret_cast<whisper_vad_context *>(handle);
    if(!vad)return nullptr;
    jfloat *pcm=env->GetFloatArrayElements(input,nullptr);
    bool ok=whisper_vad_detect_speech_no_reset(vad,pcm,env->GetArrayLength(input));
    env->ReleaseFloatArrayElements(input,pcm,JNI_ABORT);
    if(!ok)return nullptr;
    int n=whisper_vad_n_probs(vad);
    jfloatArray probabilities=env->NewFloatArray(n);
    if(probabilities)env->SetFloatArrayRegion(probabilities,0,n,whisper_vad_probs(vad));
    return probabilities;
}
extern "C" JNIEXPORT void JNICALL Java_ca_kylekeith_shottime_SpeechDetector_vadRelease(JNIEnv *,jclass,jlong handle) {
    whisper_vad_free(reinterpret_cast<whisper_vad_context *>(handle));
}
