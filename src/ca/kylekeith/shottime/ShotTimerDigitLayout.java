package ca.kylekeith.shottime;

/** Pixel layout calculated from the actual monospace font measurements. */
final class ShotTimerDigitLayout {
    final float textSize;
    final int width, height;
    ShotTimerDigitLayout(int available, int count, float size, float advance, float fontHeight, int padding) {
        int limit=Math.max(1,available/Math.max(1,count));
        float scale=Math.min(1f,Math.max(1,limit-padding*2)/advance);
        textSize=size*scale;
        width=Math.min(limit,(int)Math.ceil(advance*scale)+padding*2);
        height=(int)Math.ceil(fontHeight*scale)+padding*2;
    }
}
