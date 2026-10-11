package ca.kylekeith.shottime;
import java.util.concurrent.*;
public class WaitsTest {
    public static void main(String[] args)throws Exception{
        ThreadPoolExecutor pool=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
        final boolean[] done={false,false};
        pool.execute(()->{try{Thread.sleep(1500);}catch(InterruptedException e){}done[0]=true;});
        pool.execute(()->done[1]=true);pool.shutdown();
        Thread.currentThread().interrupt();
        boolean interrupted=Waits.untilTerminated(pool);
        if(!interrupted)throw new AssertionError("interrupt must be reported");
        if(!pool.isTerminated()||!done[0]||!done[1])throw new AssertionError("an interrupt must not end the wait before queued sections finish");
        System.out.println("PASS: Stop waits for every queued section even when interrupted");
    }
}
