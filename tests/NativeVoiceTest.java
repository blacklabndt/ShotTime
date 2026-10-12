package ca.kylekeith.shottime;
import java.io.StringReader;
public class NativeVoiceTest {
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        check(NativeVoice.supportsFast(new StringReader("processor : 0\nFeatures : fp asimd fphp asimdhp asimddp\nprocessor : 1\nFeatures : fp asimd fphp asimdhp asimddp\n")),"modern ARM cores should use optimized kernels");
        check(!NativeVoice.supportsFast(new StringReader("Features : fp asimd fphp asimdhp\n")),"missing dot product must use generic kernels");
        check(!NativeVoice.supportsFast(new StringReader("Features : fp asimd asimddp\n")),"missing FP16 must use generic kernels");
        check(!NativeVoice.supportsFast(new StringReader("Features : fp asimd fphp asimdhp asimddp\nFeatures : fp asimd\n")),"every reported CPU must support optimized instructions");
        check(!NativeVoice.supportsFast(new StringReader("")),"unknown capabilities must use generic kernels");
        check(!NativeVoice.supportsFast(new StringReader("Features : fp asimd fphp asimdhp asimddp_extra\n")),"feature tokens must match exactly");
        System.out.println("PASS: modern, older, mixed and unavailable CPU capability selection");
    }
}
