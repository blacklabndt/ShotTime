package ca.kylekeith.shottime;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Exposes only immutable CSV exports, with temporary read grants from the share sheet. */
public final class CsvProvider extends ContentProvider {
    public boolean onCreate(){return true;}
    private File resolve(Uri uri) throws FileNotFoundException {
        java.util.List<String> parts=uri.getPathSegments();
        if(parts.size()!=2 || !parts.get(0).matches("[a-f0-9-]{36}") || !parts.get(1).matches("[a-zA-Z0-9._-]{1,120}\\.csv")) throw new FileNotFoundException();
        File file=new File(new File(new File(getContext().getCacheDir(),"csv-share"),parts.get(0)),parts.get(1));
        if(!file.isFile()) throw new FileNotFoundException();
        return file;
    }
    public String getType(Uri uri){return "text/csv";}
    public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
        if(!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(resolve(uri),ParcelFileDescriptor.MODE_READ_ONLY);
    }
    public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
        try {
            File file=resolve(uri);
            String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
            MatrixCursor cursor=new MatrixCursor(columns);Object[] row=new Object[columns.length];
            for(int i=0;i<columns.length;i++){if(OpenableColumns.DISPLAY_NAME.equals(columns[i]))row[i]=file.getName();else if(OpenableColumns.SIZE.equals(columns[i]))row[i]=file.length();}
            cursor.addRow(row);return cursor;
        } catch(FileNotFoundException e){throw new IllegalArgumentException("Missing CSV",e);}
    }
    public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
    public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
}
