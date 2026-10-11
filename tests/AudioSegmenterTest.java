package ca.kylekeith.shottime;
import java.util.*;
public class AudioSegmenterTest {
    private static short[] frame(int value) { short[] f=new short[1600];Arrays.fill(f,(short)value);return f; }
    private static void check(boolean b,String msg) { if(!b)throw new AssertionError(msg); }
    public static void main(String[] args) {
        AudioSegmenter s=new AudioSegmenter();
        for(int i=0;i<100;i++)check(s.accept(frame(0),1600)==null,"silence must not decode");
        check(s.finish()==null,"silence flush");
        for(int i=0;i<5;i++)check(s.accept(frame(1000),1600)==null,"short speech must accumulate");
        float[] result=null;for(int i=0;i<10;i++){float[] c=s.accept(frame(0),1600);if(c!=null)result=c;}
        check(result!=null&&result.length>=8000,"speech was lost at pause");
        check(s.finish()==null,"pause must not duplicate the audio");
        s=new AudioSegmenter();int chunks=0;for(int i=0;i<450;i++)if(s.accept(frame(1500),1600)!=null)chunks++;
        check(chunks==2,"long speech must be bounded without dropping remainder");check(s.finish()!=null,"Stop must flush final speech");
        s=new AudioSegmenter();int samples=0;short[] partial=new short[1501];Arrays.fill(partial,(short)1000);
        for(int i=0;i<500;i++){float[] c=s.accept(partial,partial.length);if(c!=null)samples+=c.length;}
        float[] tail=s.finish();if(tail!=null)samples+=tail.length;
        check(samples==750500,"partial microphone reads must not lose samples at chunk boundaries");
        // Speech detector input (1536-sample reads, as the service uses): noise is not speech, 1 s below 0.35 ends a section.
        short[] read=new short[1536];Arrays.fill(read,(short)3000);
        s=new AudioSegmenter();for(int i=0;i<200;i++)check(s.accept(read,1536,0.1f)==null,"loud noise without speech must not decode");check(s.finish()==null,"noise flush");
        for(int i=0;i<5;i++)check(s.accept(read,1536,0.9f)==null,"speech accumulates");
        result=null;int reads=0;while(result==null&&reads<20){result=s.accept(read,1536,0.2f);reads++;}
        check(result!=null&&reads==11,"pause of one second ends the section, took "+reads);
        // Hysteresis: probabilities between 0.35 and 0.5 continue speech instead of counting as a pause.
        s=new AudioSegmenter();s.accept(read,1536,0.9f);for(int i=0;i<30;i++)check(s.accept(read,1536,0.4f)==null,"uncertain frames must not end speech");
        // Uninterrupted speech: cut at the quietest read in the last 4 s, carry the rest, lose nothing.
        s=new AudioSegmenter();int total=0,quietAt=-1;float[] first=null;
        for(int i=0;i<260;i++){float p=i==190?0.36f:0.9f;float[] c=s.accept(read,1536,p);total+=1536;if(i==190)quietAt=total;if(c!=null&&first==null)first=c;}
        check(first!=null&&first.length==quietAt,"long speech must be cut at the quiet point "+quietAt+", was "+(first==null?-1:first.length));
        float[] rest=s.finish();check(rest!=null&&first.length+rest.length==total,"audio after the cut must be kept");
        System.out.println("PASS: silent input, pause segmentation, bounded continuous audio and stop flush; speech-detector input, hysteresis and quiet-point cuts");
    }
}
