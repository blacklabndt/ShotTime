package ca.kylekeith.shottime;

/** Serial routing: a failed cloud attempt never publishes a partial result. */
final class VoiceBackend {
 interface Decoder {String decode(float[] pcm)throws Exception;}
 private final String mode;
 private final Decoder cloud,phone;
 private boolean cloudReady;
 String status;
 VoiceBackend(String mode,boolean ready,Decoder cloud,Decoder phone){
  this.mode=mode;this.cloud=cloud;this.phone=phone;cloudReady=ready&&!mode.equals("phone");
  status=cloudReady?"Cloud":"Phone";
 }
 boolean cloudReady(){return cloudReady;}
 void fallback(String reason)throws Exception{cloudReady=false;status="Phone — "+reason;if(mode.equals("cloud"))throw new Exception(reason);}
 String transcribe(float[] pcm)throws Exception{
  if(cloudReady){try{return cloud.decode(pcm);}catch(Exception e){fallback(e.getMessage());}}
  if(mode.equals("cloud"))throw new Exception("Cloud unavailable. Check key, credits and connection.");
  return phone.decode(pcm);
 }
}
