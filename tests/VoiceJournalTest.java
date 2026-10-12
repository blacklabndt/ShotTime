package ca.kylekeith.shottime;
import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.file.*;
import org.json.JSONObject;

public class VoiceJournalTest {
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static JSONObject data()throws Exception{Field field=VoiceJournal.class.getDeclaredField("data");field.setAccessible(true);return (JSONObject)field.get(null);}
    public static void main(String[] args)throws Exception{
        Path directory=Files.createTempDirectory("voice-journal-test-");
        Context context=new Context(directory.toFile());
        Path journal=directory.resolve("voice-session.json");
        try{
            String empty=VoiceJournal.snapshot(context);
            AtomicFile.failure="start";
            try{VoiceJournal.start(context,"first","");throw new AssertionError("expected initial save failure");}catch(IOException expected){}
            check(VoiceJournal.snapshot(context).equals(empty),"failed first start must not publish preparing state");
            check(!Files.exists(journal),"failed first start must not create journal");
            AtomicFile.failure="";
            VoiceJournal.start(context,"first","");
            VoiceJournal.append(context,"CN-332A has two welds");
            VoiceJournal.state(context,"stopped","Saved");
            String previousId=data().getString("id"),previous=VoiceJournal.snapshot(context);
            byte[] persisted=Files.readAllBytes(journal);
            for(String failure:new String[]{"start","write"}){
                AtomicFile.failure=failure;
                try{VoiceJournal.start(context,"second",previousId);throw new AssertionError("expected "+failure+" failure");}catch(IOException expected){}
                check(VoiceJournal.snapshot(context).equals(previous),failure+": preserve previous session snapshot");
                check(data().getString("id").equals(previousId),failure+": preserve previous session ID");
                check(VoiceJournal.transcript(context).equals("CN-332A has two welds"),failure+": preserve transcript events");
                check(java.util.Arrays.equals(persisted,Files.readAllBytes(journal)),failure+": preserve previous disk journal");
            }
            AtomicFile.failure="";
            VoiceJournal.start(context,"second",previousId);
            check(data().getString("state").equals("preparing"),"retry succeeds without process restart");
            check(!data().getString("id").equals(previousId),"retry publishes new session ID");
            check(data().getString("listId").equals("second")&&VoiceJournal.transcript(context).isEmpty(),"retry starts clean target session");
            Field state=VoiceJournal.class.getDeclaredField("data");state.setAccessible(true);
            Files.write(directory.resolve("voice-session.json.bak"),persisted);Files.delete(journal);state.set(null,null);
            check(VoiceJournal.snapshot(context).equals(previous),"backup-only restart restores the complete session");
            check(VoiceJournal.transcript(context).equals("CN-332A has two welds"),"backup transcript recovered");
            check(Files.exists(journal)&&!Files.exists(directory.resolve("voice-session.json.bak")),"atomic reader restores base");
            state.set(null,null);AtomicFile.failure="read";
            check(VoiceJournal.snapshot(context).contains("Recording is disabled"),"read failure stays blocked");
            try{VoiceJournal.start(context,"third",previousId);throw new AssertionError("read failure cannot overwrite recovery");}catch(IOException expected){}
            check(java.util.Arrays.equals(persisted,Files.readAllBytes(journal)),"read failure preserves bytes");
            AtomicFile.failure="";check(VoiceJournal.snapshot(context).equals(previous),"read retry restores previous session");
            byte[] active=previous.replace("\"stopped\"","\"listening\"").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            Files.write(journal,active);state.set(null,null);AtomicFile.failure="write";
            check(VoiceJournal.snapshot(context).contains("Recording is disabled"),"failed interrupted-state save stays blocked");
            check(java.util.Arrays.equals(active,Files.readAllBytes(journal)),"failed recovery write preserves journal");
            AtomicFile.failure="";check(VoiceJournal.snapshot(context).contains("interrupted"),"interrupted session recovered on retry");
            Files.write(journal,"not JSON".getBytes());state.set(null,null);
            check(VoiceJournal.snapshot(context).contains("Recording is disabled"),"malformed data remains recoverable");
            check(Files.readString(journal).equals("not JSON"),"malformed data is never overwritten");
            System.out.println("PASS: journal start/write failures, backup-only recovery, read/recovery-write retry and corruption preservation");
        }finally{AtomicFile.failure="";Files.deleteIfExists(directory.resolve("voice-session.json.bak"));Files.deleteIfExists(directory.resolve("voice-session.json.new"));Files.deleteIfExists(journal);Files.deleteIfExists(directory);}
    }
}
