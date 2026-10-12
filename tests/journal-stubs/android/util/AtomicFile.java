package android.util;
import java.io.*;
import java.nio.file.*;
/** JVM fault-injection double; never packaged with the app. */
public class AtomicFile {
    public static String failure="";
    private final File base, pending;
    public AtomicFile(File base){this.base=base;pending=new File(base+".new");}
    public File getBaseFile(){return base;}
    public byte[] readFully()throws IOException{
        if(failure.equals("read"))throw new IOException("injected read failure");
        Path backup=Paths.get(base+".bak");
        if(Files.exists(backup))Files.move(backup,base.toPath(),StandardCopyOption.REPLACE_EXISTING);
        try{return Files.readAllBytes(base.toPath());}catch(NoSuchFileException absent){throw new FileNotFoundException(base.toString());}
    }
    public FileOutputStream startWrite()throws IOException{
        if(failure.equals("start"))throw new IOException("injected start failure");
        return new FileOutputStream(pending){
            @Override public void write(byte[] bytes)throws IOException{
                if(failure.equals("write")){super.write(bytes,0,Math.min(8,bytes.length));throw new IOException("injected partial write failure");}
                super.write(bytes);
            }
        };
    }
    public void finishWrite(FileOutputStream stream)throws IOException{stream.close();Files.move(pending.toPath(),base.toPath(),StandardCopyOption.REPLACE_EXISTING);}
    public void failWrite(FileOutputStream stream)throws IOException{stream.close();Files.deleteIfExists(pending.toPath());}
}
