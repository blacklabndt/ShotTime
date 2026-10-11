package org.json;
import java.util.*;
/** Small JVM JSON double for journal write and recovery tests. */
public class JSONObject {
    private final Map<String,Object> values=new LinkedHashMap<>();
    public JSONObject(){}
    public JSONObject(String text){Reader reader=new Reader(text);JSONObject parsed=(JSONObject)reader.value();reader.ws();if(reader.i!=text.length())throw new IllegalArgumentException("Trailing JSON");values.putAll(parsed.values);}
    public JSONObject put(String key,Object value){values.put(key,value);return this;}
    public String optString(String key){Object value=values.get(key);return value==null?"":value.toString();}
    public String getString(String key){return optString(key);}
    public JSONArray getJSONArray(String key){return (JSONArray)values.get(key);}
    private static String quote(String text){return "\""+text.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";}
    public String toString(){StringJoiner out=new StringJoiner(",","{","}");for(Map.Entry<String,Object> entry:values.entrySet()){Object value=entry.getValue();out.add(quote(entry.getKey())+":"+(value instanceof String?quote((String)value):String.valueOf(value)));}return out.toString();}

    private static final class Reader {
        final String s;int i;Reader(String s){this.s=s;}
        void ws(){while(i<s.length()&&Character.isWhitespace(s.charAt(i)))i++;}
        void expect(char c){ws();if(i>=s.length()||s.charAt(i++)!=c)throw new IllegalArgumentException("Invalid JSON");}
        String string(){expect('"');StringBuilder out=new StringBuilder();while(i<s.length()){char c=s.charAt(i++);if(c=='"')return out.toString();if(c=='\\'){if(i>=s.length())break;c=s.charAt(i++);switch(c){case 'n':c='\n';break;case 'r':c='\r';break;case 't':c='\t';break;case 'b':c='\b';break;case 'f':c='\f';break;case 'u':c=(char)Integer.parseInt(s.substring(i,i+4),16);i+=4;break;case '"':case '\\':case '/':break;default:throw new IllegalArgumentException("Invalid escape");}}out.append(c);}throw new IllegalArgumentException("Unterminated JSON string");}
        Object value(){ws();if(i>=s.length())throw new IllegalArgumentException("Missing JSON");char c=s.charAt(i);if(c=='"')return string();if(c=='{'){i++;JSONObject o=new JSONObject();ws();if(i<s.length()&&s.charAt(i)=='}'){i++;return o;}while(true){String k=string();expect(':');o.put(k,value());ws();if(i<s.length()&&s.charAt(i)=='}'){i++;return o;}expect(',');}}if(c=='['){i++;JSONArray a=new JSONArray();ws();if(i<s.length()&&s.charAt(i)==']'){i++;return a;}while(true){a.put((JSONObject)value());ws();if(i<s.length()&&s.charAt(i)==']'){i++;return a;}expect(',');}}int start=i;while(i<s.length()&&",]} \r\n\t".indexOf(s.charAt(i))<0)i++;String token=s.substring(start,i);if(token.equals("true"))return true;if(token.equals("false"))return false;if(token.equals("null"))return null;try{return Double.valueOf(token);}catch(Exception e){throw new IllegalArgumentException("Invalid JSON token");}}
    }
}
