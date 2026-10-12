package ca.kylekeith.shottime;
public final class ShotTimerDigitLayoutTest {
    public static void main(String[] args) {
        for(int count:new int[]{5,8,9}) for(int available:new int[]{176,256,768}) for(float fontScale:new float[]{1f,1.3f,2f}) {
            float size=46*fontScale,advance=size*.61f,height=size*1.2f;
            ShotTimerDigitLayout l=new ShotTimerDigitLayout(available,count,size,advance,height,2);
            if(l.width*count>available)throw new AssertionError("Countdown exceeds card width");
            if(l.width+0.001f<advance*l.textSize/size+4)throw new AssertionError("Glyph clipped, including colon");
            if(l.height<height*l.textSize/size+4)throw new AssertionError("Font clipped vertically");
        }
        System.out.println("Timer digit layout tests passed");
    }
}
