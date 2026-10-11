package ca.kylekeith.shottime;
public class VoiceBackendTest {
 public static void main(String[] args)throws Exception{
  int[] calls={0,0};
  VoiceBackend b=new VoiceBackend("auto",true,pcm->{calls[0]++;throw new Exception("Cloud unavailable");},pcm->{calls[1]++;return "phone";});
  if(!b.transcribe(new float[1]).equals("phone")||!b.transcribe(new float[1]).equals("phone")||calls[0]!=1||calls[1]!=2)throw new AssertionError("sticky fallback");
  b=new VoiceBackend("phone",true,pcm->{throw new AssertionError("phone contacted cloud");},pcm->"phone");b.transcribe(new float[1]);
  b=new VoiceBackend("auto",false,pcm->{throw new AssertionError("missing key contacted cloud");},pcm->"phone");b.transcribe(new float[1]);
  b=new VoiceBackend("cloud",true,pcm->{throw new Exception("quota");},pcm->{throw new AssertionError("cloud-only fallback");});
  try{b.transcribe(new float[1]);throw new AssertionError("missing error");}catch(Exception expected){}
  b=new VoiceBackend("auto",true,pcm->"cloud",pcm->{throw new AssertionError("duplicate phone decode");});if(!b.transcribe(new float[1]).equals("cloud"))throw new AssertionError();
  System.out.println("PASS: Auto fallback, sticky failure, phone privacy, missing key, cloud-only and one backend per segment");
 }
}
