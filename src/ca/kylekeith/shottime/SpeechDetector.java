package ca.kylekeith.shottime;

/** Silero VAD (whisper.cpp): speech probability per 512-sample window, streamed across reads. */
final class SpeechDetector implements AutoCloseable {
    static { NativeVoice.load(); }
    static final int WINDOW=512;
    private long handle;
    SpeechDetector(String path){handle=vadLoad(path);if(handle==0)throw new IllegalStateException("Speech detector could not load.");}
    /** Highest speech probability in this read; reads should be a multiple of 512 samples. */
    float speech(short[] pcm,int count){
        float[] samples=new float[count];for(int i=0;i<count;i++)samples[i]=pcm[i]/32768f;
        float[] probabilities=vadProbs(handle,samples);if(probabilities==null)throw new IllegalStateException("Speech detection failed.");
        float best=0;for(float p:probabilities)best=Math.max(best,p);return best;
    }
    public void close(){if(handle!=0){vadRelease(handle);handle=0;}}
    private static native long vadLoad(String path);
    private static native float[] vadProbs(long handle,float[] samples);
    private static native void vadRelease(long handle);
}
