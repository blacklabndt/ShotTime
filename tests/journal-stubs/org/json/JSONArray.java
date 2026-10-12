package org.json;
import java.util.*;
public class JSONArray {
    private final List<JSONObject> values=new ArrayList<>();
    public int length(){return values.size();}
    public JSONArray put(JSONObject value){values.add(value);return this;}
    public JSONObject getJSONObject(int index){return values.get(index);}
    public String toString(){StringJoiner out=new StringJoiner(",","[","]");for(JSONObject value:values)out.add(value.toString());return out.toString();}
}
