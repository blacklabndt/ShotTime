package ca.kylekeith.shottime;

final class WhisperEngine implements AutoCloseable {
    static { NativeVoice.load(); }
    // Vocabulary hints, without an example sentence for the model to echo during silence. Welder IDs are
    // spoken as single letters, so the hint shows them that way.
    static final String HINT="Pipe inspection. CN, XF, welder ID, welds, STD, XS, XXS, schedule. Welder IDs are letters, such as D D, R G, T S, O.";
    private long handle;
    WhisperEngine(String path){handle=load(path);if(handle==0)throw new IllegalStateException("Whisper model could not load. Check free storage and reinstall this test build.");}
    /** Hint text plus the welder IDs already used on this list, so Whisper spells them the same way. */
    static String prompt(String ids){return ids==null||ids.isEmpty()?HINT:HINT+" Welder IDs on this list: "+ids.replace(",",", ")+".";}
    // Whisper returns raw UTF-8 that may split characters; Java decodes it and replaces invalid bytes.
    /** fast: shorter encoder window, for when sections are queuing up. */
    String transcribe(float[] samples,String prompt,boolean fast){byte[] text=decode(handle,samples,Math.min(4,Math.max(1,Runtime.getRuntime().availableProcessors()-2)),prompt,fast);if(text==null)throw new IllegalStateException("Whisper could not transcribe this audio. Stop and retry.");return new String(text,java.nio.charset.StandardCharsets.UTF_8);}
    public void close(){if(handle!=0){release(handle);handle=0;}}
    private static native long load(String path);
    private static native byte[] decode(long handle,float[] samples,int threads,String prompt,boolean fast);
    private static native void release(long handle);
}
