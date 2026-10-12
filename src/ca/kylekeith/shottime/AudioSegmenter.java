package ca.kylekeith.shottime;
import java.util.Arrays;

/** 16 kHz mono PCM. Keep pre-roll, cut at pauses, bound memory during uninterrupted speech. */
final class AudioSegmenter {
    static final int MAX=320000,PREROLL=4800,PAUSE=16000,MIN_SPEECH=3200,SEARCH=64000;
    private final float[] buffer=new float[MAX+8192];
    // One mark per accepted read: where it ends, how loud/likely speech it was, and whether it counted as speech.
    private final int[] ends=new int[4096];
    private final float[] levels=new float[4096];
    private final boolean[] spoken=new boolean[4096];
    private int length,marks,quiet,voiced;
    /** Fallback when the speech detector is unavailable: loudness decides speech. */
    float[] accept(short[] pcm,int count) {
        double energy=0;for(int i=0;i<count;i++)energy+=(double)pcm[i]*pcm[i];
        double rms=Math.sqrt(energy/Math.max(1,count));
        return add(pcm,count,rms>=250,(float)rms);
    }
    /** Silero speech probability for this read. Hysteresis: 0.5 starts speech, below 0.35 is a pause. */
    float[] accept(short[] pcm,int count,float probability) {
        return add(pcm,count,probability>=0.5f||probability>=0.35f&&voiced>0&&quiet==0,probability);
    }
    private float[] add(short[] pcm,int count,boolean speech,float level) {
        if(count<0||count>8192)throw new IllegalArgumentException("Microphone read too large");
        if(speech){quiet=0;voiced+=count;}else quiet+=count;
        if(voiced==0&&length+count>PREROLL)drop(Math.min(length,length+count-PREROLL));
        for(int i=0;i<count;i++)buffer[length++]=pcm[i]/32768f;
        if(marks==ends.length){System.arraycopy(ends,1,ends,0,marks-1);System.arraycopy(levels,1,levels,0,marks-1);System.arraycopy(spoken,1,spoken,0,marks-1);marks--;}
        ends[marks]=length;levels[marks]=level;spoken[marks]=speech;marks++;
        if(length>=MAX)return cut();
        if(voiced>0&&quiet>=PAUSE)return finish();
        return null;
    }
    // Uninterrupted speech: cut at the quietest read in the last 4 seconds instead of mid-word, and keep the rest.
    private float[] cut() {
        int best=-1;
        for(int i=0;i<marks;i++)if(ends[i]>=length-SEARCH&&(best<0||levels[i]<=levels[best]))best=i;
        int at=best<0?length:ends[best];
        float[] result=voiced>=MIN_SPEECH?Arrays.copyOf(buffer,at):null;
        drop(at);
        voiced=0;quiet=0;int previous=0;
        for(int i=0;i<marks;i++){int size=ends[i]-previous;previous=ends[i];if(spoken[i]){voiced+=size;quiet=0;}else quiet+=size;}
        return result;
    }
    float[] finish(){float[] result=voiced>=MIN_SPEECH?Arrays.copyOf(buffer,length):null;length=marks=quiet=voiced=0;return result;}
    private void drop(int n) {
        if(n<=0)return;
        System.arraycopy(buffer,n,buffer,0,length-n);length-=n;
        int kept=0;for(int i=0;i<marks;i++)if(ends[i]>n){ends[kept]=ends[i]-n;levels[kept]=levels[i];spoken[kept]=spoken[i];kept++;}
        marks=kept;
    }
}
