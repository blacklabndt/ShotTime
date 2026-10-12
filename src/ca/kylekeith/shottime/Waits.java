package ca.kylekeith.shottime;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

final class Waits {
    /** Waits until every queued task has finished, even if interrupted; returns whether an interrupt arrived. */
    static boolean untilTerminated(ExecutorService executor){
        boolean interrupted=false;
        while(true){
            try{if(executor.awaitTermination(1,TimeUnit.SECONDS))return interrupted;}
            catch(InterruptedException e){interrupted=true;}
        }
    }
}
