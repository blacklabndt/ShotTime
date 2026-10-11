package ca.kylekeith.shottime;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.*;
import android.view.animation.PathInterpolator;
import android.widget.*;
final class ShotTimerCard extends LinearLayout {
    private final ShotTimer timer;
    private final TextView label,detail,status;
    private final LinearLayout digits;
    private final Button primary,pausedReset;
    private final ProgressBar progress;
    private String previous="",token="";
    private String currentValue="";
    private int digitWidth,digitHeight;
    private float digitSize;
    private final int ink=Color.rgb(245,236,231),muted=Color.rgb(193,174,163),copper=Color.rgb(212,140,121);
    private int dp(float x){return (int)(x*getResources().getDisplayMetrics().density+.5f);}
    private GradientDrawable surface(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private TextView text(int size,int color){TextView v=new TextView(getContext());v.setTextColor(color);v.setTextSize(size);v.setIncludeFontPadding(false);return v;}
    private Button button(String title,boolean main){Button b=new Button(getContext());b.setText(title);b.setTextSize(13);b.setAllCaps(false);b.setTextColor(ink);b.setMinWidth(0);b.setMinimumWidth(0);b.setMinHeight(0);b.setMinimumHeight(0);b.setPadding(dp(4),0,dp(4),0);b.setBackground(surface(main?Color.rgb(167,94,80):Color.rgb(51,43,39),11));return b;}
    ShotTimerCard(Context context,ShotTimer timer){super(context);this.timer=timer;setOrientation(VERTICAL);setPadding(dp(12),dp(3),dp(12),dp(12));GradientDrawable bg=surface(Color.rgb(36,30,27),19);bg.setStroke(dp(1),Color.rgb(87,65,57));setBackground(bg);setElevation(dp(14));
        LinearLayout head=new LinearLayout(context);head.setGravity(Gravity.CENTER_VERTICAL);TextView title=text(12,muted);title.setText("⠿ Shot timer");head.addView(title,new LinearLayout.LayoutParams(0,dp(44),1));title.setGravity(Gravity.CENTER_VERTICAL);
        Button close=button("×",false);close.setContentDescription("Close and cancel timer");head.addView(close,new LinearLayout.LayoutParams(dp(44),dp(44)));close.setOnClickListener(v->timer.action("close",token));addView(head);
        final float[] pos=new float[2];View.OnTouchListener drag=(v,e)->{switch(e.getActionMasked()){case MotionEvent.ACTION_DOWN:pos[0]=e.getRawX();pos[1]=e.getRawY();return true;case MotionEvent.ACTION_MOVE:timer.move(e.getRawX()-pos[0],e.getRawY()-pos[1]);pos[0]=e.getRawX();pos[1]=e.getRawY();return true;case MotionEvent.ACTION_UP:timer.rememberPosition();v.performClick();return true;default:return true;}};head.setOnTouchListener(drag);title.setOnTouchListener(drag);
        label=text(13,ink);label.setTypeface(null,Typeface.BOLD);addView(label);detail=text(11,muted);LinearLayout.LayoutParams detailLayout=new LinearLayout.LayoutParams(-1,-2);detailLayout.topMargin=dp(2);addView(detail,detailLayout);
        digits=new LinearLayout(context);digits.setGravity(Gravity.CENTER);digits.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);LinearLayout.LayoutParams digitLayout=new LinearLayout.LayoutParams(-1,dp(58));digitLayout.topMargin=dp(3);addView(digits,digitLayout);
        digits.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{if(r-l!=or-ol&&!currentValue.isEmpty())roll(currentValue);});
        status=text(11,muted);status.setGravity(Gravity.CENTER);addView(status,new LinearLayout.LayoutParams(-1,-2));
        progress=new ProgressBar(context,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(1000);progress.setProgressTintList(android.content.res.ColorStateList.valueOf(copper));progress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(51,43,39)));LinearLayout.LayoutParams track=new LinearLayout.LayoutParams(-1,dp(3));track.setMargins(0,dp(9),0,dp(9));addView(progress,track);
        LinearLayout actions=new LinearLayout(context);pausedReset=button("Reset",false);pausedReset.setContentDescription("Restart timer from full duration");pausedReset.setVisibility(View.GONE);LinearLayout.LayoutParams resetLayout=new LinearLayout.LayoutParams(0,dp(44),1);resetLayout.rightMargin=dp(8);actions.addView(pausedReset,resetLayout);primary=button("Start",true);actions.addView(primary,new LinearLayout.LayoutParams(0,dp(44),1));addView(actions,new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.WRAP_CONTENT));pausedReset.setOnClickListener(v->timer.action("restart",token));primary.setOnClickListener(v->timer.action((String)primary.getTag(),token));
    }
    void update(ShotTimerState s,boolean acknowledged,String error){
        token=s.token();label.setText(s.label);detail.setText(s.detail);long left=s.left(SystemClock.elapsedRealtime());String value=ShotTimerState.format(left);roll(value);progress.setProgress((int)(left*1000/s.duration));
        String caption,action,button;
        switch(s.phase){case "running":caption="Counting down";action="pause";button="Pause";break;case "paused":caption="Paused";action="start";button="Resume";break;case "finished":caption=acknowledged?"Timer complete":"Time up";action=acknowledged?"reset":"ack";button=acknowledged?"Reset":"Stop";break;case "interrupted":caption="Timer interrupted — reset to continue";action="reset";button="Reset";break;default:caption="Ready to start";action="start";button="Start";}
        status.setText(error.isEmpty()?caption:error);primary.setText(button);primary.setTag(action);pausedReset.setVisibility(s.phase.equals("paused")?View.VISIBLE:View.GONE);
    }
    private void roll(String value){
        currentValue=value;
        if(digits.getWidth()<=0)return;
        android.graphics.Paint paint=new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);paint.setTypeface(Typeface.MONOSPACE);
        float size=android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP,value.length()>5?36:46,getResources().getDisplayMetrics());paint.setTextSize(size);
        float advance=0;for(char c:"0123456789:".toCharArray())advance=Math.max(advance,paint.measureText(String.valueOf(c)));
        android.graphics.Paint.FontMetrics fm=paint.getFontMetrics();
        ShotTimerDigitLayout layout=new ShotTimerDigitLayout(digits.getWidth(),value.length(),size,advance,fm.bottom-fm.top,dp(2));
        boolean rebuild=digits.getChildCount()!=value.length()||digitWidth!=layout.width||digitHeight!=layout.height||digitSize!=layout.textSize;
        if(rebuild){digitWidth=layout.width;digitHeight=layout.height;digitSize=layout.textSize;digits.removeAllViews();previous="";ViewGroup.LayoutParams row=digits.getLayoutParams();row.height=digitHeight+dp(6);digits.setLayoutParams(row);for(int i=0;i<value.length();i++){FrameLayout box=new FrameLayout(getContext());box.setClipChildren(true);digits.addView(box,new LinearLayout.LayoutParams(digitWidth,digitHeight));}}
        if(value.equals(previous))return;boolean motion=Settings.Global.getFloat(getContext().getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1)>0;
        for(int i=0;i<value.length();i++){char next=value.charAt(i);if(previous.length()==value.length()&&previous.charAt(i)==next)continue;FrameLayout box=(FrameLayout)digits.getChildAt(i);box.removeAllViews();TextView incoming=digit(next);box.addView(incoming,new FrameLayout.LayoutParams(-1,-1));
            if(motion&&previous.length()==value.length()&&next!=':'){TextView outgoing=digit(previous.charAt(i));box.addView(outgoing,new FrameLayout.LayoutParams(-1,-1));incoming.setTranslationY(digitHeight);PathInterpolator easing=new PathInterpolator(.18f,.7f,.25f,1);incoming.animate().translationY(0).setDuration(280).setInterpolator(easing).start();outgoing.animate().translationY(-digitHeight).setDuration(280).setInterpolator(easing).withEndAction(()->box.removeView(outgoing)).start();}}
        previous=value;digits.setContentDescription("Time remaining "+value);
    }
    private TextView digit(char c){TextView t=text(46,copper);t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX,digitSize);t.setPadding(0,0,0,0);t.setSingleLine(true);t.setText(String.valueOf(c));t.setTypeface(Typeface.MONOSPACE);t.setGravity(Gravity.CENTER);t.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);return t;}
}
