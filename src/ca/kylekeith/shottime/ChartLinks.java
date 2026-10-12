package ca.kylekeith.shottime;

// Exact destinations only. The WebView itself remains offline.
final class ChartLinks {
    static boolean allowed(String url) {
        return "https://www.sulzer.com/en/-/media/files/q_documents_pe/tp/tp-0008.pdf#page=25".equals(url)
            || "https://www.ipgmservicios.com/wp-content/uploads/2024/03/ASME-SEC-I-2019.pdf#page=334".equals(url)
            || "https://download.bibis.ir/Books/Construction/Pipeline/2024/CSA%20Z662-23%20(March%202024)%20Oil%20and%20gas%20pipeline%20systems_bibis.ir.pdf#page=259".equals(url)
            || "https://studylib.net/doc/28042843/asme-sec-ix-2025".equals(url);
    }
}
