package ca.kylekeith.shottime;

import android.app.*;
import android.content.*;
import android.widget.*;
import android.text.InputType;
import android.util.Base64;
import android.security.keystore.*;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

final class CloudSettings {
 private static final String ALIAS="shottime-cloud-key";
 private static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences("cloud-settings",0);}
 static String mode(Context c){return prefs(c).getString("mode","phone");}
 private static javax.crypto.SecretKey secret()throws Exception{
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(!store.containsAlias(ALIAS)){KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
  return (javax.crypto.SecretKey)store.getKey(ALIAS,null);
 }
 static String key(Context c)throws Exception{
  String encrypted=prefs(c).getString("key","");if(encrypted.isEmpty())return "";
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,Base64.decode(prefs(c).getString("iv",""),Base64.NO_WRAP)));
  return new String(cipher.doFinal(Base64.decode(encrypted,Base64.NO_WRAP)),java.nio.charset.StandardCharsets.UTF_8);
 }
 private static String month(){return java.time.YearMonth.now(java.time.ZoneOffset.UTC).toString();}
 static synchronized double used(Context c){return month().equals(prefs(c).getString("month",""))?Double.longBitsToDouble(prefs(c).getLong("used",0)):0;}
 static synchronized void reserve(Context c,double dollars)throws Exception{
  double total=used(c)+dollars,limit=Double.longBitsToDouble(prefs(c).getLong("limit",Double.doubleToLongBits(5)));
  if(!Double.isFinite(total)||total>limit)throw new Exception("Local monthly spending guard reached");
  if(!prefs(c).edit().putString("month",month()).putLong("used",Double.doubleToLongBits(total)).commit())throw new Exception("Could not save spending estimate");
 }
 static void show(Activity a,Runnable changed){
  if(VoiceService.active)return;
  LinearLayout box=new LinearLayout(a);box.setOrientation(1);box.setPadding(30,15,30,15);
  TextView info=new TextView(a);info.setText("Auto sends speech to OpenAI and falls back to this phone if cloud fails. Cloud only stops on failure. Cloud interpretations are reviewed after Stop. API billing is separate.\n\nLocal reserved estimate this UTC month: US$"+String.format(java.util.Locale.US,"%.2f",used(a))+". This is not your provider balance; failed attempts remain counted. Configure billing limits with your provider too.");box.addView(info);
  Spinner mode=new Spinner(a);mode.setAdapter(new ArrayAdapter<String>(a,android.R.layout.simple_spinner_dropdown_item,new String[]{"Phone only — free","Auto — cloud then phone","Cloud only"}));mode.setSelection(mode(a).equals("auto")?1:mode(a).equals("cloud")?2:0);box.addView(mode);
  TextView keyLabel=new TextView(a);keyLabel.setText("OpenAI API key (leave blank to keep saved key)");box.addView(keyLabel);
  EditText key=new EditText(a);key.setSingleLine(true);key.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);key.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO);box.addView(key);
  CheckBox forget=new CheckBox(a);forget.setText("Remove saved API key");box.addView(forget);
  TextView limitLabel=new TextView(a);limitLabel.setText("Monthly local guard (USD; 0 disables cloud)");box.addView(limitLabel);
  EditText limit=new EditText(a);limit.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);limit.setText(String.valueOf(Double.longBitsToDouble(prefs(a).getLong("limit",Double.doubleToLongBits(5)))));box.addView(limit);
  ScrollView scroll=new ScrollView(a);scroll.addView(box);
  AlertDialog dialog=new AlertDialog.Builder(a).setTitle("Voice processing").setView(scroll).setNegativeButton("Cancel",null).setPositiveButton("Save",null).create();
  dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(w->{try{
   double amount=Double.parseDouble(limit.getText().toString());if(!Double.isFinite(amount)||amount<0||amount>100)throw new Exception("Use a monthly guard from $0 to $100");
   String supplied=key.getText().toString().trim();android.content.SharedPreferences.Editor editor=prefs(a).edit();
   if(forget.isChecked())editor.remove("key").remove("iv");
   else if(!supplied.isEmpty()){if(supplied.length()>512||!supplied.matches("[A-Za-z0-9_-]+"))throw new Exception("Invalid key format");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secret());editor.putString("key",Base64.encodeToString(cipher.doFinal(supplied.getBytes(java.nio.charset.StandardCharsets.UTF_8)),Base64.NO_WRAP)).putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP));}
   editor.putString("mode",new String[]{"phone","auto","cloud"}[mode.getSelectedItemPosition()]).putLong("limit",Double.doubleToLongBits(amount));if(!editor.commit())throw new Exception("Could not save settings");key.setText("");dialog.dismiss();changed.run();
  }catch(Exception e){Toast.makeText(a,"Settings not saved: "+e.getMessage(),Toast.LENGTH_LONG).show();}}));dialog.show();
 }
}
