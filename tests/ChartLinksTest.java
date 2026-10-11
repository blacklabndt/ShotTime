package ca.kylekeith.shottime;
public final class ChartLinksTest {
 public static void main(String[] args) {
  String[] links={"https://www.sulzer.com/en/-/media/files/q_documents_pe/tp/tp-0008.pdf#page=25","https://www.ipgmservicios.com/wp-content/uploads/2024/03/ASME-SEC-I-2019.pdf#page=334","https://download.bibis.ir/Books/Construction/Pipeline/2024/CSA%20Z662-23%20(March%202024)%20Oil%20and%20gas%20pipeline%20systems_bibis.ir.pdf#page=259","https://studylib.net/doc/28042843/asme-sec-ix-2025"};
  for(String link:links) {
   if(!ChartLinks.allowed(link))throw new AssertionError("Missing chart destination");
   for(String bad:new String[]{link+"&redirect=https://example.com",link.replace("https:","http:"),link.replace("https://","https://evil.example/"),link+"/"})
    if(ChartLinks.allowed(bad))throw new AssertionError("Untrusted destination allowed");
  }
  for(String bad:new String[]{null,"https://example.com","javascript:alert(1)","file:///sdcard/file.pdf","shottime://reference"})
   if(ChartLinks.allowed(bad))throw new AssertionError("Unexpected destination allowed");
  System.out.println("PASS: chart destination allowlist");
 }
}
