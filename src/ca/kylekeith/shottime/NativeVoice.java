package ca.kylekeith.shottime;
import java.io.*;
import java.util.*;

/** Select once for both Whisper and Silero; unknown hardware keeps the portable ARM64 library. */
final class NativeVoice {
    private static boolean loaded;
    static synchronized void load(){
        if(loaded)return;
        boolean fast=false;
        try(Reader info=new FileReader("/proc/cpuinfo")){fast=supportsFast(info);}catch(IOException|SecurityException ignored){}
        if(fast){try{System.loadLibrary("shottime_whisper_fast");loaded=true;return;}catch(UnsatisfiedLinkError ignored){}}
        System.loadLibrary("shottime_whisper");loaded=true;
    }
    static boolean supportsFast(Reader source)throws IOException{
        BufferedReader reader=new BufferedReader(source);String line;boolean found=false;
        while((line=reader.readLine())!=null){
            int colon=line.indexOf(':');if(colon<0||!line.substring(0,colon).trim().equalsIgnoreCase("Features"))continue;
            Set<String> flags=new HashSet<>(Arrays.asList(line.substring(colon+1).trim().split("\\s+")));
            if(!flags.containsAll(Arrays.asList("asimd","fphp","asimdhp","asimddp")))return false;
            found=true;
        }
        return found;
    }
}
